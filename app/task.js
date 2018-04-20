//Database
var mongo = require('mongodb');
var monk = require('monk');


function create(app, params) {

	var tasks = app.db.get('tasks');

	params.creationDate = new Date();
	params.processing = false;
	params.complete = false;
	params.error = null;

	tasks.insert(params).then((doc) => {
		app.stdout(doc.mediaLibrary, 'Creating new Task: ' + doc.type + ', ID: '+ doc._id);
	});

}

function launch(app) {

	var tasks = app.db.get('tasks');




	tasks.find({
		processing: true
	}).then((t) => {

		if (t.length >= app.config.threads) {
			app.stdout(null,  'Busy, delaying new task...');
		}
		else {
			tasks.findOneAndUpdate(
				{
					processing: false,
					complete: false,
					error: null,
					creationDate: {"$lte": new Date()}
				},
				{
					$set: { processing: true }
				},
				{
					sort: { priority: 1 }
				}
				).then((doc) => {

					if (doc == null || !doc.type)
						return false;


					switch (doc.type) {
						case 'fullscan' :
						case 'scan':

							//Module de scan
							var scan = require('./scan.js');

							if (doc.type == 'fullscan') {
								//Gestionnaire de taches
								var watcher = require('./watcher.js');
								watcher.removeAll(app, doc.mediaLibrary);
							}

							var s = new scan({
								app: app,
								mediaLibrary: doc.mediaLibrary
							});

							//Les compteurs continuent de s'incrémenter dans s...

							function checkCounterDir(s, doc) {
							    if (s.getCounter('counterDirs','done') < s.getCounter('counterDirs','scan')) {
							       setTimeout(function() {
								       checkCounterDir(s, doc);
								    }, 50);
							    } else {
							      app.stdout(doc.mediaLibrary,  'Directory indexation done');

							      app.stdout(doc.mediaLibrary,  'Starting file indexation...');

							      s.scanFiles(doc, doc.path);

							      checkCounterFiles(s, doc);
							    }
							}


							function checkCounterFiles(s, doc) {
								if (s.getCounter('counterFiles','done') < s.getCounter('counterFiles','scan')) {
									setTimeout(function() {
										checkCounterFiles(s, doc);
								    }, 50);
							    } else {
							      app.stdout(doc.mediaLibrary,  'File indexation done');

							      app.stdout(doc.mediaLibrary,  'Removing deleted elements...');

							      s.removeDeleted(doc, doc.path);

							      setTimeout(function() {
							     	 checkCounterRemove(s, doc);
							      }, 50);
							    }
							}

							function checkCounterRemove(s, doc) {
							    if (s.getCounter('counterRemove','done') < s.getCounter('counterRemove','scan')) {
							       setTimeout(function() {
								       checkCounterRemove(s, doc);
								    }, 50);
							    } else {
							      app.stdout(doc.mediaLibrary,  'Removing deleted elements done');
								  if (doc.type == 'fullscan') {
									  /*Problème avec les déplacements : le dossier d'origine est scanné, l'objet a disparu, il est retiré de la base... à revoir !*/
											watcher.setWatchers(app, doc.mediaLibrary);
							      }
							      end(app, tasks, doc);
							    }
							}

							app.stdout(doc.mediaLibrary,  'Starting directory '+doc.path+' indexation...');

							s.scanDir(doc, doc.path);

							checkCounterDir(s, doc);


						break;

						/*case 'scan' :
							console.log('scanner le dossier '+doc.path);
							end(app, tasks, doc);
						break;*/
					}
				}
			);
		}

		app.execTask();
	});
}

function end(app, tasks, obj) {
	tasks.update(
		{_id: obj._id},
		{$set: { complete: true, processing: false }}
	).then(() => {
		app.stdout(obj.mediaLibrary, 'Finishing Task: ' + obj.type + ', ID: '+ obj._id);

		if (obj.next) {

			//On recherche si une tâche identique n'est pas déjà planifiée
			tasks.findOne({
				processing: false,
				complete: false,
				type: obj.type,
				mediaLibrary: obj.mediaLibrary,
				next: obj.next
			}).then((t) => {
				if (t == null) {
					obj.creationDate = new Date(new Date().getTime() + obj.next*60000);
					delete obj._id;
					obj.processing = false;
					obj.complete = false;
					obj.error = null;

					tasks.insert(obj).then(() => {
						app.stdout(obj.mediaLibrary, 'Scheduling new Task: ' + obj.type);
					});
				}
			});
		}

	});
}


function flushComplete(app, tasks) {
	tasks.remove({complete: true, error: null}).then(() => {
		app.stdout(null, 'Flushing complete tasks');
	});
}

function cancel(app, tasks) {
	//Au démarrage de l'application, annule les tâches encore en cours.
	//Si elles ont des processus extérieurs, il faudrait les killer.
	tasks.find({processing: true}).then((d) => {
		if (d.length > 0) {
			app.stdout(null, 'Aborting '+d.length+' tasks');

			for (var t in d)
				tasks.findOneAndUpdate({_id: d[t]._id}, {$set: {processing: false, error: 'Aborted'}});
		}
	});
}

module.exports = {

	create: create,
	launch:launch,
	flushComplete: flushComplete,
	cancel: cancel

}
