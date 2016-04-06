'use strict';

var Promise = require('bluebird'),
    mysql = require('mysql'),
    mongoose = require('mongoose'),
    path = require('path'),
    slugify = require('slug'),
    secureRandom = require('secure-random'),
    fs = require('fs-extra'),
    config = require('../../../lib/config'),
    skipOrphans = false, connection;

mongoose.Promise = Promise;
Promise.promisifyAll(fs);

module.exports.run = Promise.coroutine(function* () {
    yield config.load();

    connection = mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'root',
        database: 'leerstandsmelder-neu',
        port: 8889
    });
    Promise.promisifyAll(connection);

    if (!config.get) {
        throw new Error('Server has not been configured yet. Please run bin/setup.');
    }

    var resources = [
            {res: 'Comment', path: '/comments', model: require('../../../models/comment').Comment, legacy: 'post_comments'},
            {res: 'Comment', path: '/comments', model: require('../../../models/comment').Comment, legacy: 'comments'},
            {res: 'Location', path: '/locations', model: require('../../../models/location').Location, legacy: 'places'},
            {res: 'Region', path: '/regions', model: require('../../../models/region').Region, legacy: 'groups'},
            {res: 'Photo', path: '/photos', model: require('../../../models/photo').Photo, legacy: 'pictures'},
            {res: 'Post', path: '/posts', model: require('../../../models/post').Post, legacy: 'posts'},
            {res: 'User', path: '/users', model: require('../../../models/user').User, legacy: 'users'}
        ],
        dburl = 'mongodb://' +
            config.get.mongodb.host + ':' +
            config.get.mongodb.port + '/' +
            config.get.mongodb.dbname;

    console.log('connecting to ' + dburl);
    return new Promise(function (resolve) {
            mongoose.connect(dburl);
            mongoose.connection.on('connected', function () {
                for (var r of resources) {
                    mongoose.model(r.res, r.model);
                }
                console.log('connected to mongodb!');
                resolve();
            });
        })
        .then(() => {
            return Promise.map(resources, (resource) => {
                console.log('Checking deleted items for resource ' + resource.res);
                return mongoose.model(resource.res).find({})
                    .then((results) => {
                        return results;
                    })
                    .map((item) => {
                        var query;
                        if (!item.legacy_id) {
                            console.log('no legacy id for resource ' + resource.res + ' item UUID: ' + item.uuid);
                            return;
                        }
                        if (resource.legacy === 'post_comments') {
                            if (item.legacy_id.indexOf('pc-') > -1) {
                                query = 'SELECT * FROM ' + resource.legacy + ' WHERE id=' + item.legacy_id.replace('pc-', '');
                            } else {
                                return;
                            }
                        } else if (resource.legacy === 'comments') {
                            if (item.legacy_id.indexOf('pc-') === -1) {
                                query = 'SELECT * FROM ' + resource.legacy + ' WHERE id=' + item.legacy_id;
                            } else {
                                return;
                            }
                        } else {
                            query = 'SELECT * FROM ' + resource.legacy + ' WHERE id=' + item.legacy_id;
                        }
                        return connection.queryAsync(query)
                            .then(function (rows) {
                                if (rows.length === 0) {
                                    console.log('deleting resource ' + resource.res + ': missing entry with legacy_id ' + item.legacy_id);
                                    return mongoose.model(resource.res).findOneAndRemove({uuid:item.uuid});
                                }
                            });
                    }, {concurrency: 1});
            }, {concurrency: 1});
        })
        .then(() => {
            connection.end();
            console.log('done.');
            process.exit(0);
        });
});
