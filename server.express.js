import express from 'express';
var http 					= require('http');
var https 					= require('https');
var bodyParser 				= require('body-parser');
var cookieParser 			= require('cookie-parser');
var session      			= require('express-session');
var moment 					= require('moment');
const app 					= express();
var path 					= require('path');
var formidable 				= require('formidable');
var fs 						= require('fs');
const aws 					= require('aws-sdk');
const querystring 			= require('querystring');
import {
//Utilities
  pad,
  def,
  fallback,
  err,
  errstr,
  errdict,
  geterr,
  projf,
  projff,
//Object utilities
  mutate,
  remove,
  rotate
} from 'wircho-utilities';

const S3_BUCKET = process.env.S3_BUCKET_NAME;
const CLARIFAI_KEY = process.env.CLARIFAI_KEY;

// Local Utilities/Constants
var extRE = /(?:\.([^.]+))?$/;

var clarifaiFeatureKeys = ["road", "no person", "street", "outdoors", "travel", "environment",
"vehicle", "urban", "transportation system", "city", "calamity", "pavement", "landscape", "car",
"building", "people", "offense", "police", "accident", "architecture", "traffic", "guidance",
"asphalt", "storm", "nature", "tree", "battle", "daylight", "house", "sign", "light", "action",
"rain", "wood", "park", "old", "business", "rally", "desktop", "competition", "industry",
"summer", "flood", "grass", "weather", "home", "stone", "ground", "garden", "water", "waste",
"empty", "garbage", "texture", "concrete", "leaf", "wall", "highway", "pollution", "drive",
"family", "hurricane", "sky", "flora", "soil", "dirty", "pattern", "danger", "track", "abstract",
"graffiti", "expression", "truck", "wheel", "town", "war", "trash", "military", "abandoned",
"window", "surface", "blur", "color", "automotive", "one", "blacktop", "hurry", "demolition",
"safety", "flower", "sand", "security", "recycling", "race", "broken", "door", "adult", "motion",
"savings", "rock", "auto racing", "lane", "cement", "lawn", "seat", "bus", "rough",
"climate change", "container", "footpath", "beach", "indoors", "steel", "winter", "design",
"soccer", "retro", "brick", "train", "line", "modern", "litter", "room", "recreation", "fast",
"stock", "growth", "construction", "fence", "vintage", "rebellion", "warning", "tarmac", "text",
"man", "museum", "earthquake", "hood", "commerce", "emergency", "shadow", "bitumen", "snow",
"roadway", "flame", "bench", "symbol", "furniture", "fall", "yard", "tourism", "reflection",
"food", "group", "art", "railway", "bridge", "seashore", "desert", "dust", "walk", "floor", "rural",
"stop", "agriculture", "airport", "religion", "iron", "tube", "river", "luxury", "public",
"technology", "season", "parking lot", "vertical", "entrance", "injury", "chair", "finance", "paper",
"dark", "cold", "show", "gravel", "election", "exhibition", "wet", "championship", "sedan",
"football", "equipment", "disposal", "exterior", "driver", "damage", "vandalism", "force", "sea",
"driveway", "branch", "fair weather", "pool", "horizontal", "windshield", "energy", "crash", "farm",
"antique", "fabric", "backyard", "evening", "roadside", "caution", "wooden", "leisure", "crack",
"field", "child", "wear", "interaction", "paving", "dump", "bin", "ancient", "ice", "noon",
"close-up", "hole", "perspective", "power", "woman", "wire", "plastic", "lush", "tar", "vacation",
"scenic", "painting", "rusty", "junk", "downtown", "cobblestone", "information", "airplane", "bomb",
"forbidden", "coupe", "step", "law enforcement", "speed", "glass", "electricity", "intersection",
"contemporary", "inside", "sunset", "box", "interior design"];

var categories = [
	"Pothole",
	"Graffiti",
	"Trees & Branches",
	"Sidewalk Repair",
	"Vehicles & Parking",
	"Garbage & Litter",
	"Signage",
	"Drains & Flooding",
	"Lights"
];

function loadCSV(fileName) {
	return new Promise(function(res,rej) {
		fs.readFile(fileName,'utf8',function(error,data) {
			if (error) { rej(error); return; }
			var lines = data.split(/\r\n|\n/);
			var matrix = [];
			var cols = 0;
			for (var i=0; i<lines.length; i+=1) {
				var entries = lines[i].split(",").map((n)=>{return n*1;});
				if (i === 0) {
					cols = entries.length;
				} else if (cols !== entries.length) {
					continue;
				}
				matrix.push(entries);
			}
			res(matrix);
		});
	});
}

var theta1 = loadCSV("thetas/theta1.csv");
var theta2 = loadCSV("thetas/theta2.csv");
var thetas = Promise.all([theta1,theta2]);
thetas.then(function(thetas) {
	var theta1 = thetas[0];
	var theta2 = thetas[1];
	console.log("There are " + clarifaiFeatureKeys.length + " features");
	console.log("Theta1 is " + theta1.length + " x " + theta1[0].length);
	console.log("Theta2 is " + theta2.length + " x " + theta2[0].length);
	console.log("There are " + categories.length + " categories");
}, function(error) {
	console.log("Error getting thetas: " + errstr(error))
});

function applyMatrix(vector,matrix) {
	var result = [];
	for (var i=0; i<matrix.length; i+=1) {
		var row = matrix[i];
		var value = row[0];
		for (var j=1; j<row.length; j+=1) {
			value += row[j] * vector[j-1];
		}
		result.push(value);
	}
	return result;
}

function applySigmoid(vector) {
	return vector.map((value) => {
		return 1 / (1 + Math.exp(-value));
	});
}

function applyML(vector,theta1,theta2) {
	return applySigmoid(applyMatrix(applySigmoid(applyMatrix(vector,theta1)),theta2));
}

function processTags(json) {
	return new Promise(function(res,rej) {
		var results = json.results;
        if (!def(results) || results.length === 0) { rej(err("No results")); return; }
        var result = results[0].result;
        if (!def(result)) { rej(err("No result.")); return; }
        var tag = result.tag;
        if (!def(tag)) { rej(err("No tags.")); return; }
        var classes = tag.classes;
        var probs = tag.probs;
        if (!def(classes) || !def(probs) || classes.length === 0 || classes.length !== probs.length) { rej(err("No classes or probs.")); return; }
        var num = classes.length;
        var dict = {};
        for (var i=0; i<num; i+=1) {
        	dict[classes[i]] = probs[i];
        }
        var vector = [];
        for (var i=0; i<clarifaiFeatureKeys.length; i+=1) {
        	vector.push(fallback(dict[clarifaiFeatureKeys[i]],0));
        }
        thetas.then(function(thetas) {
	        var answer = applyML(vector,thetas[0],thetas[1]);
	        var tags = [];
	        for (var i=0; i<categories.length; i+=1) {
	        	tags.push({name:categories[i],value:answer[i]});
	        }
	        tags.sort((a,b) => {
	        	return (a.value < b.value) ? (-1) : ((a.value > b.value) ? 1 : 0);
	        });
	        res({tags});
        },rej);
        
	});
}

//Babel+Webpack
app.use('/', express.static('public'));

//AWS
function fileExists(s3,fileName) {
	var params = {
		Bucket: S3_BUCKET,
		Key: fileName
	};
	return new Promise(function(res,rej) {
		s3.headObject(params,function(error,metadata) {
			if (error) {
				if (error.code === "NotFound") {
					res(false);
				}else {
					rej(err(error));
				}
			}else {
				res(true);
			}
		});
	})
}
function generateFileName(ext) {
	var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for(var i=0; i<5; i+=1) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    if (def(ext)) {
    	return text + "." + ext;
    }else {
    	return text;
    }
}
function generateUniqueFileName(s3,ext,againstExt) {
	return new Promise(function(res,rej) {
		var fileName = generateFileName(ext);
		var againstFileName = def(againstExt) ? (fileName + "." + againstExt) : fileName;
		fileExists(s3,againstFileName).then(function(exists) {
			if (exists) {
				generateUniqueFileName(s3,ext,againstExt).then(res,rej);
			} else {
				res(fileName);
			}
		},rej);
	});
}
const validFileExtensions = ["jpg","jpeg","gif","png"];
function isExtensionValid(ext) {
	return validFileExtensions.indexOf(ext) > -1;
}

//API
app.get('/sign-s3', function(req, res) {
	const s3 = new aws.S3();
	const originalFileName = req.query['name'];
	const ext = def(originalFileName) ? extRE.exec(originalFileName)[1].toLowerCase() : undefined;
	const fileType = req.query['type'];
	generateUniqueFileName(s3,ext).then(function(fileName) {
		var params = {
			Bucket: S3_BUCKET,
			Key: fileName,
			Expires: 60,
			ContentType: fileType,
			ACL: 'public-read'
		};
		s3.getSignedUrl('putObject', params, (error, data) => {
			if (error) {
				res.json(errdict(error));
				return;
			}
			res.json({
				fileName,
				signedRequest: data,
				url: "https://" + S3_BUCKET + ".s3.amazonaws.com/" + fileName
			});
		});
	}, function(error) {
		res.json(errdict(error));
	});
});

app.get('/tags', function(req,res) {
	const url = req.query['url'];
	console.log("HTTPS REQUEST BEGAN!");
	var body = querystring.stringify({url});
	var req = https.request({
		host: "api.clarifai.com",
		path: "/v1/tag/",
		method: "POST",
		headers: {
			"Authorization": "Bearer " + CLARIFAI_KEY,
			"Content-Type": "application/x-www-form-urlencoded",
			"Content-Length": Buffer.byteLength(body)
		}
	}, (response) => {
		var body = "";
		response.on("data", function(d) {
			body += d;
		});
		response.on("end", function() {
			var json = JSON.parse(body);
			processTags(json).then(function(tagsJSON) {
				res.json(tagsJSON);
			}, function(error) {
				res.json(errdict(error));
			});
		});
	});
	req.on("error", (error) => {
		res.json(errdict(error));
	});
	req.write(body);
	req.end();
});

/*
app.get('/all-submissions', function(req, res) {
	const s3 = new aws.S3();
	var params = {
		Bucket: S3_BUCKET
	}
	s3.listObjects(params, function(error,data) {
		if (error) {
			res.json(errdict(error));
			return;
		}
		var truncated = data.IsTruncated;
		var contents = data.Contents.filter(function(element) {
			return element.Key.indexOf(".json") > -1;
		});
		contents.sort(function(a,b) {
			return (a.LastModified < b.LastModified) ? 1 : ((a.LastModified > b.LastModified) ? (-1) : 0);
		});
		var locale = {timeZone:"America/Montreal"};
		res.json(contents.map(function(element) {
			return {
				fileName: element.Key,
				url: "https://" + S3_BUCKET + ".s3.amazonaws.com/" + element.Key,
				date: element.LastModified.toLocaleDateString(locale) + " - " + element.LastModified.toLocaleTimeString(locale)
			};
		}));
	});
});
*/

// app.post('/submit', function (req, res) {
// 	var form = new formidable.IncomingForm();
// 	form.parse(req, function(error,fields,files) {
// 		if (error) {
// 			req.json(errdict(error));
// 			return;
// 		}
		
// 		res.json({id:"1"});
// 	});
// });

app.listen(process.env.PORT || 8080);