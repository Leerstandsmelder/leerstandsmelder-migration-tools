#!/usr/bin/env node

'use strict';

var Promise = require('bluebird'),
    request = require('request'),
    mongoose = require('mongoose'),
    markdown = require('to-markdown'),
    config = require('../../../lib/config');

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
        if (!location.hidden) {
            location.hidden = false;
        }
        return location.save();
    }), {concurrency: 10});
    console.log('done setting hidden attribute.');
});