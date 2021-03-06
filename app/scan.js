var fs = require('fs');
var watcher = require('app/watcher.js');

var core = require('app/core');

//Models
var File = require('models/file'); // get our mongoose model
var Dir  = require('models/dir');


function Scan(params) {

	var parentThis = this;

	this.mediaLibrary = params.mediaLibrary;


	var DS = core.config().directorySeparator;


	for (let conf of core.config().mediaLibraries) {
		if (conf.id == parentThis.mediaLibrary) {
			parentThis.rootPath = conf.rootPath;
			break;
		}
	}

	if (!fs.existsSync(parentThis.rootPath)) {
		core.stdout(this.mediaLibrary,  'ERROR: Root directory not found');
		return false;
	}

	this.counterDirs = {
		scan: 0,
		done: 0
	}

	this.counterFiles = {
		scan: 0,
		done: 0
	}
	this.counterRemove = {
		scan: 0,
		done: 0
	}

	//Si le dossier racine n'existe pas, on le créé
	Dir.lib(parentThis.mediaLibrary).findOne({path: '', name: '__ROOT__'}, function(err, d) {
		if (!err && d == null) {
			var obj = fs.statSync(parentThis.rootPath);

			var r = new Dir.lib(parentThis.mediaLibrary)({
				path: '',
				name: '__ROOT__',
				inode: obj.ino,
				size: obj.size,
				creationDate: new Date(obj.birthtimeMs),
				modificationDate: new Date(obj.ctimeMs),
				parent: null
			});

			r.save(function(err) {
				if (!err) {
					core.stdout(parentThis.mediaLibrary,  'Inserting Root directory');
				}
				else {
					throw err;
					return false;
				}
			});
		}
	});

	this.scanDir = function(task, path, filelist) {

		if (fs.existsSync(parentThis.rootPath + path)) {
			var files = fs.readdirSync(parentThis.rootPath + path);

			filelist = filelist || [];

			files.forEach(function(file) {
				var obj = fs.statSync(parentThis.rootPath + path + DS + file);

				if (obj.isDirectory() ) {
					counterAdd('counterDirs', 'scan');
					//parentThis.counterDirs.scan++;
					parentThis.index(path, file, obj, function() {
						if (task.recurse == true)
							parentThis.scanDir(task, path + DS + file, filelist);
					});
				}
			});
		}
	}


	this.scanFiles = function(task, path, filelist) {
		if (fs.existsSync(parentThis.rootPath + path)) {
			var files = fs.readdirSync(parentThis.rootPath + path);

			filelist = filelist || [];

			files.forEach(function(file) {
				var obj = fs.statSync(parentThis.rootPath + path + DS + file);

				if (obj.isFile() ) {
					counterAdd('counterFiles', 'scan');
					parentThis.index(path, file, obj);
				}

				if (obj.isDirectory() ) {

					if (task.recurse == true)
						parentThis.scanFiles(task, path + DS + file, filelist);
				}

			});
		}
	}

	this.removeDeleted = function (task, path) {
		if (path != '') {
			//On recherche le dossier parent du fichier path/name
			var lastIndex = path.lastIndexOf(DS);
			var ppath = path.substr(0, lastIndex);
			var pname = path.substr(lastIndex + 1);

		}
		else {
			var ppath = '';
			var pname = "__ROOT__";
		}

		Dir.lib(parentThis.mediaLibrary).findOne({path: ppath, name: pname}, function(err, di) {
			if (err) {
				throw err;
				return false;
			}

			if (di == null) {
				core.stdout(parentThis.mediaLibrary, 'Can\'t remove ' + path + ' (Parent not found)');
				counterAdd('counterRemove', 'done');
				return false;
			}

			var parentId = di._id;
			if (path != '')
				var search = {path: parentId}
			else
				var search = {}

			File.lib(parentThis.mediaLibrary).find(search, function(err, files) {
				if (err) {
					throw err;
					return false;
				}

				for (let f of files) {
					counterAdd('counterRemove', 'scan');
					if (f.path) {
						Dir.lib(parentThis.mediaLibrary).findOne({_id: f.path}, function(err, d) {
							if (!err && d !== null) {
								if (d.name == '__ROOT__')
									d.name = '';

								var p = parentThis.rootPath + d.path + DS + d.name + DS + f.name;
								if (fs.existsSync(p)) {
									counterAdd('counterRemove', 'done');
								}
								else {
									//Supprimer le fichier de la base
									File.lib(parentThis.mediaLibrary).findOneAndRemove({_id: f._id}, function(err) {
										if (!err) {
											core.stdout(parentThis.mediaLibrary,  'Removing file ' + p);
											counterAdd('counterRemove', 'done');
										}
									});
								}
							}
							else { //Ne doit pas arriver
								counterAdd('counterRemove', 'done');
							}


						});
					}
					else {
						counterAdd('counterRemove', 'done');
					}

				}

			});

			Dir.lib(parentThis.mediaLibrary).find({ name: { $not: /^__ROOT__/ }}, function(err, dirs) {

				for (let d of dirs) {
					counterAdd('counterRemove', 'scan');

					var p = parentThis.rootPath + d.path + DS + d.name;

					if (fs.existsSync(p)) {
						counterAdd('counterRemove', 'done');
					}
					else {
						//Supprimer le dossier de la base
						Dir.lib(parentThis.mediaLibrary).findOneAndRemove({_id: d._id}, function(err) {
							if (!err) {
								core.stdout(parentThis.mediaLibrary,  'Removing directory ' + p);
								counterAdd('counterRemove', 'done');
							}
						});
					}

				}

			});
		});
	}

	this.index = function(path, name, obj, callback) {

		//name peut être un dossier, alors path est vide

		//A la fin, il faudra parcourir la base pour rechercher les fichiers et dossiers qui n'existent plus et qu'il faut supprimer

		//SI ON INDEXE UN DOSSIER -------------
		if (obj.isDirectory()) {

			Dir.lib(parentThis.mediaLibrary).findOne({path: path, name: name}, function(err, d) {
				if (err) {
					throw err;
					return false;
				}

				var record = {
					path: path,
					name: name,
					inode: obj.ino,
					size: obj.size,
					creationDate: new Date(obj.birthtimeMs),
					modificationDate: new Date(obj.ctimeMs)
				}

				if (d == null) { //Le dossier n'a pas été trouvé avec son chemin
					//Peut-être son node ID existe déjà en base, auquel cas il aurait été déplacé ?
					Dir.lib(parentThis.mediaLibrary).findOne({inode: obj.ino}, function(err, d) {
						if (err) {
							throw err;
							return false;
						}

						if (d == null) { //Le dossier n'a pas été trouvé avec son inode : il faut l'inscrire

							//On doit récupérer son parent
							getParent(path, name, function(id) {
								record.parent = id;
								//Puis insérer
								var r = new Dir.lib(parentThis.mediaLibrary)(record);


								r.save(function(err) {
									if (err) {
										throw err;
										return false;
									}

									watcher.addWatcher(parentThis.mediaLibrary, path + DS + name);
									core.stdout(parentThis.mediaLibrary,  'Inserting directory ' + path + DS + name + ', Inode: '+obj.ino);
									counterAdd('counterDirs', 'done');

									callback.call(this);
									return true;

								});

							});

						}
						else { //Le dossier a été trouvé avec son inode : il faut mettre à jour son emplacement

							getParent(path, name, function(id) {
								record.parent = id;
								//Puis insérer

								Dir.lib(parentThis.mediaLibrary).findOneAndUpdate({ _id: d._id},{ $set: record }, function (err) {
									if (err) {
										throw err;
										return false;
									}

									core.stdout(parentThis.mediaLibrary,  'Moving directory ' + path + DS + name + ', Inode: '+obj.ino);
									counterAdd('counterDirs', 'done');
									callback.call(this);
									return true;

								});

							});

						}
					});

				}
				else { //Le dossier a été trouvé, n'a pas été déplacé ni renommé.
					//Sa taille, son inode ou sa date pourraient avoir été modifiées...
					if (obj.ino != d.inode || obj.size != d.size || Math.floor(obj.ctimeMs) != d.modificationDate.getTime()) {

						d.size = obj.size;
						d.modificationDate = new Date(obj.ctimeMs);
						d.inode = obj.ino;


						Dir.lib(parentThis.mediaLibrary).findOneAndUpdate({ _id: d._id},{ $set: d }, function (err) {
							if (err) {
								throw err;
								return false;
							}

							core.stdout(parentThis.mediaLibrary,  'Updating directory ' + path + DS + name + ', Inode: '+obj.ino);

							//watcher.addWatcher(parentThis.mediaLibrary, path + DS + name);

							counterAdd('counterDirs', 'done');
							callback.call(this);
							return true;

						});

					}
					else {
						counterAdd('counterDirs', 'done');
						callback.call(this);
						return true;
					}
				}

			});
		}

		//SI ON INDEXE UN FICHIER -------------
		if (obj.isFile()) {

			//On recherche le dossier parent du fichier path/name
			var lastIndex = path.lastIndexOf(DS);
			var ppath = path.substr(0, lastIndex);
			var pname = path.substr(lastIndex + 1);

			if (pname == '')
				pname = '__ROOT__';

			Dir.lib(parentThis.mediaLibrary).findOne({path: ppath, name: pname}, function(err, di) {
				if (err) {
					throw err;
					return false;
				}

				//Un dossier parent est trouvé pour le chemin du fichier
				if (di !== null) {
					var id = di._id;

					var record = {
						path: id,
						name: name,
						inode: obj.ino,
						size: obj.size,
						creationDate: new Date(obj.birthtimeMs),
						modificationDate: new Date(obj.ctimeMs)
					}


					File.lib(parentThis.mediaLibrary).findOne({path: id, name: name}, function(err, d) {
						if (err) {
							throw err;
							return false;
						}

						if (d == null) { //Le fichier n'est pas indexé dans ce dossier. Peut-être est-il ailleurs ?

							//Peut-être son node ID existe déjà en base, auquel cas il aurait été déplacé ?
							File.lib(parentThis.mediaLibrary).findOne({inode: obj.ino}, function(err, d) {
								if (err) {
									throw err;
									counterAdd('counterFiles', 'done');
									return false;
								}


								if (d == null) { //Le fichier n'a pas été trouvé avec son inode : il faut l'inscrire
									record.version = 1;


									var r = new File.lib(parentThis.mediaLibrary)(record);

									r.save(function(err) {
										if (err) {
											throw err;
											return false;
										}

										core.stdout(parentThis.mediaLibrary,  'Inserting file ' + path + DS + name + ', Inode: '+obj.ino);
										counterAdd('counterFiles', 'done');
										return true;

									});

								}
								else { //Le fichier a été trouvé avec son inode : il faut mettre à jour son emplacement


									var lastIndex = path.lastIndexOf(DS);
									var ppath = path.substr(0, lastIndex);
									var pname = path.substr(lastIndex + 1);

									if (pname == '')
										pname = '__ROOT__';

									Dir.lib(parentThis.mediaLibrary).findOne({path: ppath, name: pname}, function(err, dd) {
										if (err) {
											throw err;
											counterAdd('counterFiles', 'done');
											return false;
										}

										record.path = dd._id;
										record.name = name;


										//Le fichier pourrait avoir été modifié également
										if (record.modificationDate != d.modificationDate.getTime()) {
											record.version = d.version + 1;
										}



										//Puis updater
										File.lib(parentThis.mediaLibrary).findOneAndUpdate({ _id: d._id},{ $set: record }, function (err) {
											counterAdd('counterFiles', 'done');

											if (err) {
												throw err;
												return false;
											}

											core.stdout(parentThis.mediaLibrary,  'Moving  file ' + path + DS + name + ', Inode: '+obj.ino);
											return true;
										});

									});

								}
							});
						}
						else { //Un fichier portant ce nom a été trouvé à cet emplacement
							//Rien à faire, ou mise à jour
							if (obj.ino != d.inode || obj.size != d.size || Math.floor(obj.ctimeMs) != d.modificationDate.getTime()) {

								if (Math.floor(obj.ctimeMs) != d.modificationDate.getTime()) {
									d.version = d.version + 1;
								}

								d.size = obj.size;
								d.modificationDate = new Date(obj.ctimeMs);
								d.inode = obj.ino;


								File.lib(parentThis.mediaLibrary).findOneAndUpdate({ _id: d._id},{ $set: d }, function (err) {
									counterAdd('counterFiles', 'done');

									if (err) {
										throw err;
										return false;
									}

									core.stdout(parentThis.mediaLibrary,  'Updating file ' + path + DS + name + ', Inode: '+obj.ino);
									return true;
								});

							}
							else {
								counterAdd('counterFiles', 'done');
								return true;
							}
						}

					});

				}
				else {
					core.stdout(parentThis.mediaLibrary,  'ERROR: parent dir not found for indexing file ' + path + DS + name + ', Inode: '+obj.ino);
					counterAdd('counterFiles', 'done');
					//NE DOIT PAS ARRIVER ?
				}

			});


		}



		//Recherche le dossier parent du path/name du dossier
		function getParent(path, name, callback) {
			if (name == '__ROOT__' && path == '') {
				callback.call(this, null);
				return false;
			}

			//Ce sont des dossier de 1er niveau
			if (name !== '__ROOT__' && path == '') {
				var ppath = '';
				var pname = '__ROOT__';
			}
			else {
				var lastIndex = path.lastIndexOf(DS);
				var ppath = path.substr(0, lastIndex);
				var pname = path.substr(lastIndex + 1);
			}


			Dir.lib(parentThis.mediaLibrary).findOne({path: ppath, name: pname }, function(err, d) {
				if (err) {
					throw err;
				}

				if (err || d == null) { //Pas trouvé le parent ??? Hum, Ne doit pas arriver ?
					callback.call(this, false);
				}
				else {

					callback.call(this, d._id);
				}
			});
		}


	}


	function counterAdd(counter, type) {
		parentThis[counter][type]++;
	}

	this.getCounter = function(counter, type) {
		return parentThis[counter][type];
	}
}





module.exports = Scan;
