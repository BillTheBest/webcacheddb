(function(window) {

/**
 * Web cached DB
 * To unify the cached interface
 */

var Q = require('q'),
    DB_SIZE = 10 * 1024 * 1024,
    DB_STORE_NAME = '__webcached_db_name__',
    noop = function() {},
    error = function(error) {
        log(error || 'Error');
    },
    indexedDB,
    webSQL,
    localStore,
    db;


// indexedDB
indexedDB = {
    _mode: "readwrite",
    _getStore: function() {
        var context = indexedDB.db.transaction([DB_STORE_NAME], indexedDB._mode);

        return context.objectStore(DB_STORE_NAME);
    },
    _handle: function(request, onSuccess, onFail) {
        request.onsuccess = function(e) {
            log(e);

            onSuccess(e.target.result);
        };

        request.onerror = function(e) {
            log([indexedDB.dbName, indexedDB.dbVersion, e.target.error]);

            onFail(e.target.error.message);
        };
    },
    open: function(dbName, dbVersion, onSuccess, onFail, dbSize) {
        indexedDB.dbName = dbName;
        indexedDB.dbVersion = dbVersion;

        var request = window.indexedDB.open(dbName, dbVersion);
        var processed = false;

        window.setTimeout(function() {
            // browser may not call event listeners
            if ( processed ) {
                return;
            }

            try {
                // When the done flag is false, getting this property must throw a DOMException of type InvalidStateError
                if ( request.readyState == "done" && request.error ) {
                    return onFail(request.error.message);
                }
            }
            catch (e) {
                log(e);
                if ( /VersionError/gi.test(e.name) ) {
                    return onFail(e.message)
                }
            }
        }, 100);

        request.onsuccess = function(e) {
            log(e);
            processed = true;

            db = indexedDB.db = e.target.result;

            if ( !db.objectStoreNames.contains(DB_STORE_NAME) ) {
                db = indexedDB.db = null;
                onFail('ObjectStore missed');
            }
            else {
                onSuccess(e.target.result);
            }
        };

        request.onblocked = function(e) {
            log([dbName, dbVersion, e.target.error]);
            processed = true;

            onFail(e.target.error && e.target.error.message);
        };

        request.onerror = function(e) {
            log([dbName, dbVersion, e.target.error]);
            processed = true;

            onFail(e.target.error.message);
        };

        request.onupgradeneeded = function (e) {
            log("onupgradeneeded");
            processed = true;

            indexedDB.store = e.target.result.createObjectStore(DB_STORE_NAME, { keyPath: 'id' } );
        };
    },
    put: function(key, value, onSuccess, onFail) {
        try {
            var store = indexedDB._getStore();

            log(store);

            var request = store.put({id: key, content: value});

            indexedDB._handle(request, onSuccess, onFail);
        }
        catch (e) {
            onFail(e);
        }
    },
    get: function(key, onSuccess, onFail) {
        try {
            var store = indexedDB._getStore();
            var request = store.get(key);

            indexedDB._handle(request, function(result) {
                onSuccess(result && result.content);
            }, onFail);
        }
        catch (e) {
            onFail(e);
        }
    },
    remove: function(key, onSuccess, onFail) {
        try {
            var store = indexedDB._getStore();
            var request = store.delete(key);
            
            indexedDB._handle(request, onSuccess, onFail);
        }
        catch (e) {
            onFail(e);
        }
    },
    clear: function(onSuccess, onFail) {
        try {
            var store = indexedDB._getStore();
            var request = store.clear();
            
            indexedDB._handle(request, onSuccess, onFail);
        }
        catch (e) {
            onFail(e);
        }
    }
};


// web SQL
webSQL = {
    open: function(dbName, dbVersion, onSuccess, onFail, dbSize) {
        webSQL.dbName = dbName;
        webSQL.dbVersion = dbVersion;

        try {
            db = openDatabase(dbName, dbVersion, DB_STORE_NAME, dbSize);
            webSQL.db = db;

            db.transaction(function (tran) {
                tran.executeSql("SELECT id FROM cache LIMIT 1", [], function(tran, result) {
                    onSuccess(db);
                }, function(tran, err) {
                    tran.executeSql("CREATE TABLE cache (id TEXT PRIMARY KEY, content TEXT, timestamp DATETIME)", [], function(tran, result) {
                        onSuccess(db);
                    }, function(tran, err) {
                        throw err;
                    });
                });
            });
        }
        catch (e) {
            onFail(e.message);
        }
    },
    put: function(key, value, onSuccess, onFail) {
        try {
            db.transaction(function(tran) {
                var values = [value, +new Date(), key];

                // TRY INSERT
                tran.executeSql("INSERT INTO cache(content, timestamp, id) VALUES (?, ?, ?)", values, function(t, result) {
                    onSuccess(result.insertId);
                }, function(tran, err) {

                    // TRY UPDATE
                    tran.executeSql("UPDATE cache SET content = ?, timestamp = ? WHERE id = ?", values, function(tran, result) {
                        onSuccess(result.rowsAffected);
                    }, function(tran, err) {
                        throw err;
                    });
                });
            });
        }
        catch (e) {
            onFail(e.message);
        }
    },
    get: function(key, onSuccess, onFail) {
        try {
            db.transaction(function(tran) {

                tran.executeSql("SELECT content FROM cache WHERE id = ?", [key], function(t, result) {
                    var value = result.rows.item(0);
                    onSuccess(value && value.content);
                }, function(tran, err) {
                    throw err
                });
            });
        }
        catch (e) {
            onFail(e.message);
        }
    },
    remove: function(key, onSuccess, onFail) {
        try {
            db.transaction(function(tran) {

                tran.executeSql("DELETE FROM cache WHERE id = ?", [key], function(t, result) {
                    onSuccess(result.rowsAffected);
                }, function(tran, err) {
                    throw err
                });
            });
        }
        catch (e) {
            onFail(e);
        }
    },
    clear: function(onSuccess, onFail) {
        try {
            db.transaction(function(tran) {

                tran.executeSql("DELETE FROM cache", [], function(t, result) {
                    onSuccess(result.rowsAffected);
                }, function(tran, err) {
                    throw err
                });
            });
        }
        catch (e) {
            onFail(e.message);
        }
    }
};


// localStorage
localStore = {
    open: function(dbName, dbVersion, onSuccess, onFail, dbSize) {
        onSuccess(window.localStorage);
    },
    put: function(key, value, onSuccess, onFail) {
        try {
            onSuccess(window.localStorage.setItem(key, value));
        }
        catch (e) {
            onFail(e);
        }
    },
    get: function(key, onSuccess, onFail) {
        try {
            onSuccess(window.localStorage.getItem(key));
        }
        catch (e) {
            onFail(e);
        }
    },
    remove: function(key, onSuccess, onFail) {
        try {
            onSuccess(window.localStorage.removeItem(key));
        }
        catch (e) {
            onFail(e);
        }
    },
    clear: function(onSuccess, onFail) {
        try {
            onSuccess(window.localStorage.clear());
        }
        catch (e) {
            onFail(e);
        }
    }
};


function log(info) {
    window.location.href.indexOf('debug') > 0 && window.console && window.console.log(info);
}

function CachedDB() {

}

function engine() {
    return window.localStorage && localStore;

    return window.indexedDB && indexedDB || window.openDatabase && webSQL || localStore;
}

function open(dbName, dbVersion, onSuccess, onFail, dbSize) {
    dbSize = dbSize || DB_SIZE;
    dbVersion = Number(dbVersion);
    onSuccess = onSuccess || noop;
    onFail = onFail || error;

    var deferred = Q.defer();

    if ( db ) {
        onSuccess(db);
        deferred.resolve(db);

        return deferred;
    }

    (engine()).open(dbName, dbVersion, function(result) {
        db = result;
        onSuccess(db);
        deferred.resolve(result);
    }, function(error) {
        onFail(error);
        deferred.reject(error);
    });

    return deferred.promise;
}

function put(key, value, onSuccess, onFail) {
    onSuccess = onSuccess || noop;
    onFail = onFail || error;

    var deferred = Q.defer();

    try {
        value = JSON.stringify(value);

        (engine()).put(key, value, function(result) {
            onSuccess(result);
            deferred.resolve(result);
        }, function(error) {
            onFail(error);
            deferred.reject(error);
        });
    }
    catch (e) {}

    return deferred.promise;
}

function get(key, onSuccess, onFail) {
    onSuccess = onSuccess || noop;
    onFail = onFail || error;

    var deferred = Q.defer();

    (engine()).get(key, function(result) {
        try {
            result = JSON.parse(result);
            onSuccess(result);
        }
        catch (e) {}
        deferred.resolve(result);
    }, function(error) {
        onFail(error);
        deferred.reject(error);
    });

    return deferred.promise;
}

function remove(key, onSuccess, onFail) {
    onSuccess = onSuccess || noop;
    onFail = onFail || error;

    var deferred = Q.defer();

    (engine()).remove(key, function(result) {
        onSuccess(result);
        deferred.resolve(result);
    }, function(error) {
        onFail(error);
        deferred.reject(error);
    });

    return deferred.promise;
}

function clear(onSuccess, onFail) {
    onSuccess = onSuccess || noop;
    onFail = onFail || error;

    var deferred = Q.defer();

    (engine()).clear(function(result) {
        onSuccess(result);
        deferred.resolve(result);
    }, function(error) {
        onFail(error);
        deferred.reject(error);
    });

    return deferred.promise;
}

CachedDB.prototype = {
    open: open,
    put: put,
    get: get,
    remove: remove,
    clear: clear,
    imgToBase64: function(url, callback, outputFormat) {
        var canvas = document.createElement('CANVAS');
        var ctx = canvas.getContext('2d');
        var img = new Image();
        img.crossOrigin = 'Anonymous';

        try {
            img.onload = function() {
                canvas.height = img.height;
                canvas.width = img.width;
                ctx.drawImage(img,0,0);
                var dataURL = canvas.toDataURL(outputFormat || 'image/png');
                callback.call(this, dataURL);
                canvas = null; 
            };
        }
        catch (e) {}

        img.src = url;
    }
};


window.cachedDB = new CachedDB();

})(window);