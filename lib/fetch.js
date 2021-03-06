#!/usr/bin/env node

'use strict';

var Promise = require('bluebird'),
    request = require('request'),
    mongoose = require('mongoose'),
    path = require('path'),
    fs = require('fs-extra'),
    checksum = require('checksum'),
    config = require('../../../lib/config'),
    fetchedItems = 0;

mongoose.Promise = Promise;
Promise.promisifyAll(fs);
Promise.promisifyAll(checksum);

var downloadImage = Promise.promisify((url, dest, cb) => {
    let read = request(url);
    read.on('response', function (response) {
        if (response.statusCode !== 200) {
            if (response.statusCode === 404) {
                cb(new Error('server returned status:' + response.statusCode));
            } else {
                throw new Error('fatal: server returned ' + response.statusCode);
            }
        } else {
            let write = fs.createWriteStream(dest);
            write.on('close', function () {
                cb(null, true);
            });
            write.on('error', function (err) {
                cb(err);
            });
            read.pipe(write)
                .on('error', function (err) {
                    cb(err);
                });
        }
    });
    read.on('error', function (err) {
        console.log('image download error:' + err.message);
        cb(err);
    });
});

module.exports.run = Promise.coroutine(function* () {
    yield config.load();
    if (!config.get) {
        throw new Error('Server has not been configured yet. Please run bin/setup.');
    }
    var dburl = 'mongodb://' +
        config.get.mongodb.host + ':' +
        config.get.mongodb.port + '/' +
        config.get.mongodb.dbname;
    mongoose.connect(dburl);
    mongoose.model('Photo', require('../../../models/photo').Photo);
    yield fs.mkdirpAsync(path.join('assets', 'photos'));
    var photos = yield mongoose.model('Photo').find({});
    console.log('found ' + photos.length + ' photos');
    yield Promise.map(photos, Promise.coroutine(function* (photo) {
        var url = 'http://www.leerstandsmelder.de/system/photos/' + photo.legacy_id + '/original/' + photo.filename + '.' + photo.extension,
            destPath = path.resolve('assets/photos/' + photo.uuid);
        if (!photo.legacy_id) {
            console.log('warning: skipping record without legacy id for id: %s', photo.uuid);
            return;
        }
        var success = yield downloadImage(url, destPath)
            .catch(function (err) {
                console.log('download error: %s for UUID %s', err.message, photo.uuid);
            });
        if (success) {
            var filehash = yield checksum.fileAsync(destPath);
            yield Promise.resolve(mongoose.model('Photo').findOneAndUpdate({id: photo.id}, {filehash: filehash}))
                .catch(function (err) {
                    console.log('update error: %s for UUID %s', err.message, photo.uuid);
                });
        } else {
            yield Promise.resolve(mongoose.model('Photo').findOneAndRemove({id: photo.id}))
                .catch(function (err) {
                    console.log('remove error: %s for UUID %s', err.message, photo.uuid);
                });
        }
        fetchedItems += 1;
        if (fetchedItems % 10 === 0) {
            console.log(fetchedItems + ' photos processed');
        }
    }), {concurrency: 10});
    console.log('done. fetched items:', fetchedItems);
});