#!/usr/bin/env node

'use strict';

var fetch = require('./lib/fetch'),
    migrate = require('./lib/migrate'),
    slugs = require('./lib/slugs');

let argv = require('yargs')
    .string('action')
    .argv;

if (argv.action === 'fetch') {
    return fetch.run();
} else if (true || argv.action === 'migrate') {
    return migrate.run();
} else if (argv.action === 'slugs') {
    return slugs.run();
}