#!/usr/bin/env node

'use strict';

var Promise = require('bluebird'),
    request = require('request'),
    mongoose = require('mongoose'),
    checksum = require('checksum'),
    slugify = require('slug'),
    config = require('../../../lib/config'),
    processedItems = 0;

mongoose.Promise = Promise;

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
    mongoose.model('Location', require('../../../models/location').Location);
    var locations = yield mongoose.model('Location').find({});
    console.log('found ' + locations.length + ' locations');
    yield Promise.map(locations, Promise.coroutine(function* (location) {
        if (location.legacy_id) {
            location.legacy_slug = slugify(location.legacy_id + '-' + location.title).toLowerCase();
        }
        processedItems += 1;
    }), {concurrency: 10});
    console.log('done. processed items:', processedItems);
});