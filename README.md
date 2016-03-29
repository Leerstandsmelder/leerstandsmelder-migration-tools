# Leerstandsmelder Migration Tools

Commandline tools to migrate the legacy data to the new structure.

## Install

From the root of your Leerstandsmelder API Server installation, run ``npm install leerstandsmelder-migration-tools``.

## Usage

You can then issue the following commands:

- ``./node_modules/.bin/lsm-migration --action=migrate`` to transfer the data from the configured MySQL instance to the MongoDB specified in the API server config file._
- ``./node_modules/.bin/lsm-migration --action=fetch`` to fetch the image files from the old site.
- ``./node_modules/.bin/lsm-migration --action=slugs`` generate legacy slugs for old style URLs.