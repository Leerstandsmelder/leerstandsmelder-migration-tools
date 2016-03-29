'use strict';

var Promise = require('bluebird'),
    mysql = require('mysql'),
    mongoose = require('mongoose'),
    path = require('path'),
    slugify = require('slug'),
    secureRandom = require('secure-random'),
    fs = require('fs-extra'),
    config = require('../../../lib/config'),
    skipOrphans = false;

mongoose.Promise = Promise;

var connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'leerstandsmelder',
    port: 8889
});

Promise.promisifyAll(connection);
Promise.promisifyAll(fs);

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
    mongoose.model('User', require('../../../models/user').User);
    mongoose.model('Comment', require('../../../models/comment').Comment);
    mongoose.model('Location', require('../../../models/location').Location);
    mongoose.model('Region', require('../../../models/region').Region);
    mongoose.model('Photo', require('../../../models/photo').Photo);
    mongoose.model('Post', require('../../../models/post').Post);
    connection.connect();

    yield fs.mkdirpAsync(path.join('..', '..', '..', 'assets', 'photos'));
    yield importGroups();
    yield importUsers();
    yield importPlaces();
    yield importPhotos();
    yield importComments();
    yield importPosts();
    yield importPostComments();
    tearDown();
});

function importUsers() {
    var count = 0;
    return connection.queryAsync('SELECT * FROM users')
        .then(function (rows) {
            return rows;
        })
        .map(function (user) {
            var passbytes = secureRandom.randomBuffer(16);
            var userObject = {
                nickname: user.nickname,
                password: passbytes.toString('hex'),
                email: user.email,
                legacy_id: user.id,
                last_login: user.last_sign_in_at,
                confirmed: user.confirmed_at !== null,
                created: user.created_at,
                updated: user.updated_at,
                scopes: ['user']
            };
            return connection.queryAsync('SELECT role_id FROM roles_users WHERE user_id=' + user.id)
                .then(function (results) {
                    for (var i in results) {
                        if (results[i].role_id === 1) {
                            userObject.scopes.push('admin');
                        }
                    }
                    return connection.queryAsync('SELECT group_id FROM memberships WHERE user_id=' + user.id)
                        .map(function (item) {
                            return mongoose.model('Region').findOne({ legacy_id: item.group_id })
                                .then(function (region) {
                                    userObject.scopes.push('region-' + region.uuid);
                                });
                        });
                })
                .then(function () {
                    return insertOrUpdate(userObject, 'User')
                        .then(function () {
                            count += 1;
                            if (count % 500 === 0) {
                                console.log('processed %d users', count);
                            }
                        })
                        .catch(function (err) {
                            console.log('warning: could not insert user for legacy id %s with error: %s', userObject.legacy_id, err.message);
                        });
                });
        }, {concurrency: 10})
        .then(function () {
            console.log('done processing %d users', count);
        })
        .catch(function (err) {
            console.log('error processing users: ' + err.message);
        });
}

function importPlaces() {
    var count = 0;
    return connection.queryAsync('SELECT * FROM places')
        .then(function (rows) {
            return rows;
        })
        .map(function (row) {
            var placeObject = {
                title: row.name,
                description: row.description,
                owner: getOwnerFromString(row),
                rumor: row.destruction === 1,
                emptySince: getEmptySinceFromString(row),
                buildingType: row.usage,
                street: row.street,
                city: row.city,
                postcode: row.zip,
                lonlat: [row.lng, row.lat],
                legacy_id: row.id,
                active: !(row.inactive === 1),
                created: row.created_at,
                updated: row.updated_at,
                legacy_slug: slugify(row.id + '-' + row.name).toLowerCase()
            };
            return getUuidForLegacyId(row.user_id, 'User')
                .then(function (userUuid) {
                    if (!userUuid && skipOrphans) {
                        console.log('warning: skipping orphan record id %s for user id %s', row.id, row.user_id);
                    } else {
                        placeObject.user_uuid = userUuid;
                        if (placeObject.user_uuid === undefined) placeObject.user_uuid = 'anonymous';
                        return getUuidForLegacyId(row.group_id, 'Region');
                    }
                })
                .then(function (regionUuid) {
                    if (!regionUuid) {
                        regionUuid = 'orphaned';
                    }
                    placeObject.region_uuid = regionUuid;
                    return insertOrUpdate(placeObject, 'Location');
                })
                .then(function (location) {
                    if (location) {
                        count += 1;
                        if (count % 500 === 0) {
                            console.log('processed %d locations', count);
                        }
                    }
                })
                .catch(function (err) {
                    console.log('warning: could not insert location for legacy id %s with error: %s', placeObject.legacy_id, err.message);
                });;
        }, {concurrency: 10})
        .then(function () {
            console.log('done processing %d locations', count);
        });
}

function importGroups() {
    var count = 0;
    return connection.queryAsync('SELECT * FROM groups')
        .then(function (rows) {
            return rows;
        })
        .map(function (row) {
            var groupObject = {
                title: row.name,
                lonlat: [row.lng, row.lat],
                legacy_id: row.id,
                hide: row.hide === 1,
                hide_message: row.hide_message,
                zoom: row.zoom,
                created: row.created_at,
                updated: row.updated_at
            };
            return insertOrUpdate(groupObject, 'Region')
                .then(function (location) {
                    if (location) {
                        count += 1;
                        if (count % 25 === 0) {
                            console.log('processed %d groups', count);
                        }
                    }
                })
                .catch(function (err) {
                    console.log('warning: could not insert group for legacy id %s with error: %s', groupObject.legacy_id, err.message);
                });
            ;
        }, {concurrency: 10})
        .then(function () {
            console.log('done processing %d groups', count);
        });
}

function importComments() {
    var count = 0;
    return connection.queryAsync('SELECT * FROM comments')
        .then(function (rows) {
            return rows;
        })
        .map(function (row) {
            var commentObject = {
                body: row.body || '[EMPTY BODY]',
                legacy_id: row.id,
                created: row.created_at,
                updated: row.updated_at
            };
            return getUuidForLegacyId(row.user_id, 'User')
                .then(function (userUuid) {
                    if (!userUuid) {
                        userUuid = 'anonymous';
                    }
                    commentObject.user_uuid = userUuid;
                    return getUuidForLegacyId(row.place_id, 'Location');
                })
                .then(function (locationUuid) {
                    if (!locationUuid) {
                        locationUuid = 'orphaned';
                    }
                    commentObject.subject_uuid = locationUuid;
                    if ((!commentObject.subject_uuid || !commentObject.user_uuid) && skipOrphans) {
                        console.log('warning: skipping orphan record id %s for user id %s and place id %s', row.id, row.user_id, row.place_id);
                    } else {
                        return insertOrUpdate(commentObject, 'Comment');
                    }
                })
                .then(function (comment) {
                    if (comment) {
                        count += 1;
                        if (count % 500 === 0) {
                            console.log('processed %d comments', count);
                        }
                    }
                })
                .catch(function (err) {
                    console.log('warning: could not insert comment for legacy id %s with error: %s', row.id, err.message);
                });
        }, {concurrency: 10})
        .then(function () {
            console.log('done processing %d comments', count);
        });
}

function importPhotos() {
    var count = 0;
    return connection.queryAsync('SELECT * FROM pictures')
        .then(function (rows) {
            return rows;
        })
        .map(function (row) {
            var photoObject = {
                filename: row.photo_file_name.split('.')[0],
                extension: path.extname(row.photo_file_name).replace('.', ''),
                mime_type: row.photo_content_type,
                filehash: 'unknown',
                size: row.photo_file_size,
                position: row.position,
                legacy_id: row.id,
                created: row.created_at,
                updated: row.updated_at
            };
            if (photoObject.extension === '' && photoObject.mime_type === 'image/jpeg') photoObject.extension = 'jpg';
            return getUuidForLegacyId(row.user_id, 'User')
                .then(function (userUuid) {
                    if (!userUuid) {
                        userUuid = 'anonymous';
                    }
                    photoObject.user_uuid = userUuid;
                    photoObject.creator_uuid = userUuid;
                    photoObject.publisher_uuid = userUuid;
                    photoObject.rights_holder_uuid = userUuid;
                    return getUuidForLegacyId(row.place_id, 'Location');
                })
                .then(function (locationUuid) {
                    photoObject.location_uuid = locationUuid;
                    if ((!photoObject.location_uuid || !photoObject.user_uuid) && skipOrphans) {
                        console.log('warning: skipping orphan record id %s for user id %s and place id %s', row.id, row.user_id, row.place_id);
                    } else {
                        return insertOrUpdate(photoObject, 'Photo');
                    }
                })
                .then(function (photo) {
                    if (photo) {
                        count += 1;
                        if (count % 500 === 0) {
                            console.log('processed %d photos', count);
                        }
                    }
                })
                .catch(function (err) {
                    console.log('warning: could not insert photo for legacy id %s with error: %s', row.id, err.message);
                });
        }, {concurrency: 10})
        .then(function () {
            console.log('done processing %d photos', count);
        });
}

function importPosts() {
    var count = 0;
    return connection.queryAsync('SELECT * FROM posts')
        .then(function (rows) {
            return rows;
        })
        .map(function (row) {
            var commentObject = {
                title: row.title,
                body: row.body,
                legacy_id: row.id,
                created: row.created_at,
                updated: row.updated_at
            };
            return insertOrUpdate(commentObject, 'Post')
                .then(function (post) {
                    if (post) {
                        count += 1;
                        if (count % 500 === 0) {
                            console.log('processed %d posts', count);
                        }
                    }
                })
                .catch(function (err) {
                    console.log('warning: could not insert post for legacy id %s with error: %s', row.id, err.message);
                });
        }, {concurrency: 10})
        .then(function () {
            console.log('done processing %d posts', count);
        });
}

function importPostComments() {
    var count = 0;
    return connection.queryAsync('SELECT * FROM post_comments')
        .then(function (rows) {
            return rows;
        })
        .map(function (row) {
            var commentObject = {
                body: row.body || '[EMPTY BODY]',
                legacy_id: 'pc-' + row.id,
                created: row.created_at,
                updated: row.updated_at
            };
            return getUuidForLegacyId(row.user_id, 'User')
                .then(function (userUuid) {
                    if (!userUuid) {
                        userUuid = 'anonymous';
                    }
                    commentObject.user_uuid = userUuid;
                    return getUuidForLegacyId(row.post_id, 'Post');
                })
                .then(function (postUuid) {
                    if (!postUuid) {
                        postUuid = 'orphaned';
                    }
                    commentObject.subject_uuid = postUuid;
                    if ((!commentObject.subject_uuid || !commentObject.user_uuid) && skipOrphans) {
                        console.log('warning: skipping orphan record id %s for user id %s and place id %s', row.id, row.user_id, row.place_id);
                    } else {
                        return insertOrUpdate(commentObject, 'Comment');
                    }
                })
                .then(function (comment) {
                    if (comment) {
                        count += 1;
                        if (count % 500 === 0) {
                            console.log('processed %d post comments', count);
                        }
                    }
                })
                .catch(function (err) {
                    console.log('warning: could not insert post comment for legacy id %s with error: %s', row.id, err.message);
                });
        }, {concurrency: 10})
        .then(function () {
            console.log('done processing %d comments', count);
        });
}

function insertOrUpdate(payload, resourceName) {
    return mongoose.model(resourceName).findOne({legacy_id: payload.legacy_id})
        .then(function (existing) {
            if (!existing) {
                return mongoose.model(resourceName).create(payload);
            } else {
                return mongoose.model(resourceName).findOneAndUpdate({legacy_id: payload.legacy_id}, payload);
            }
        })
        .catch(function (err) {
            console.log('failed to insert/update resource ' +
                resourceName + ' with legacy id: ' +
                payload.legacy_id + ' message: ' + err.message);
            return null;
        });
}

function getUuidForLegacyId(legacyId, resourceName) {
    return Promise.resolve()
        .then(function () {
            return mongoose.model(resourceName).findOne({legacy_id: legacyId}).exec();
        })
        .then(function (user) {
            if (user) {
                return user.uuid;
            }
        });
}

function getEmptySinceFromString(row) {
    var result;
    switch (row.since) {
        case 'seit Kurzem':
            result = 'locations.empty_options.recently';
            break;
        case 'mindestens 5 Jahre':
            result = 'locations.empty_options.min_five_years';
            break;
        case 'mindestens 3 Jahre':
            result = 'locations.empty_options.min_three_years';
            break;
        case 'mindestens 1 Jahr':
            result = 'locations.empty_options.min_one_year';
            break;
        case 'seit einem halben Jahr':
            result = 'locations.empty_options.about_half_year';
            break;
    }
    return result;
}

function getOwnerFromString(row) {
    var result;
    switch (row.owner) {
        case 'privat':
            result = 'locations.owner_options.private';
            break;
        case 'öffentliche Hand':
            result = 'locations.owner_options.public';
            break;
    }
    return result;
}

function tearDown(err) {
    connection.end();
    if (err) {
        console.log('failed with error: %s', err.message);
        console.log(err.stack);
    }
    console.log('done. exiting.');
    process.exit(err ? 1 : 0);
}