module.exports = function(app, api) {
	
	
	var bodyParser = require('body-parser');
	
	// parse application/x-www-form-urlencoded
	api.use(bodyParser.urlencoded({ extended: false }))
	
	// parse application/json
	api.use(bodyParser.json())
	
	var file = require('../controllers/file');
	
	file.setApp(app);
	/*api.route('/files')
		.get(filengine.get_files);
		.post(filengine.create_file);*/
	
	api.route('/:mediaLibraryId/file/:fileId')
		.get(file.get)
		.post(file.test_post);
	
};