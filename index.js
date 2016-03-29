#!/usr/bin/env node

'use strict';

var fetch = require('./lib/fetch'),
    migrate = require('./lib/migrate');

let argv = require('yargs')
    .string('action')
    .argv;

if (argv.action === 'fetch') {
    return fetch.run();
} else if (argv.action === 'migrate') {
    return migrate.run();
}