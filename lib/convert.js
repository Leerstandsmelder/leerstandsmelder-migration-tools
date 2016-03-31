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
    mongoose.model('Post', require('../../../models/post').Post);
    var posts = yield mongoose.model('Post').find({});
    console.log('found ' + posts.length + ' posts');
    yield Promise.map(posts, Promise.coroutine(function* (post) {
        post.body = markdown(post.body);
        return post.save();
    }), {concurrency: 10});
    console.log('done converting html to markdown.');
});