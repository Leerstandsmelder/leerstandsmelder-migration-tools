#!/usr/bin/env node

'use strict';

var fetch = require('./lib/fetch'),
    migrate = require('./lib/migrate'),
    slugs = require('./lib/slugs'),
    convert = require('./lib/convert'),
    setHidden = require('./lib/set-hidden'),
    remove = require('./lib/remove');

let argv = require('yargs')
    .string('action')
    .argv;

if (argv.action === 'fetch') {
    return fetch.run();
} else if (argv.action === 'migrate') {
    return migrate.run();
} else if (argv.action === 'slugs') {
    return slugs.run();
} else if (argv.action === 'convert') {
    return convert.run();
} else if (argv.action === 'set-hidden') {
    return setHidden.run();
} else if (argv.action === 'remove') {
    return remove.run();
}