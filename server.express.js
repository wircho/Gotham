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

// Promise utilities
function tryPromise(times,maker) {
	return new Promise(function(res,rej) {
		var promise = maker();
		promise.then(res, function(error) {
			if (times <= 1) {
				rej(error);
				return;
			}
			tryPromise(times-1,maker).then(res, rej);
		});
	});
}

// Utilities
var extRE = /(?:\.([^.]+))?$/;

//HTTP->HTTPS Redirect
app.use(function(req, res, next) {
	var secure = req.headers['x-forwarded-proto'] === "https";
	if (secure || req.headers.host.indexOf("localhost") === 0 || req.headers.host.indexOf("127.0.0.1") === 0) {
		next();
	}else {
		res.redirect('https://' + req.headers.host + req.url);
	}
});

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
function generateUniqueFileName(s3,ext) {
	return new Promise(function(res,rej) {
		var fileName = generateFileName(ext);
		fileExists(s3,fileName + ".json").then(function(exists) {
			if (exists) {
				generateUniqueFileName(s3).then(res,rej);
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
function getSignedURLInfo(s3,originalFileName,fileType,ext) {
	return new Promise(function(res,rej) {
		if (!def(originalFileName) || !def(fileType) || !def(ext)) {
			res({});
			return;
		}
		if (!isExtensionValid(ext)) {
			rej(err("Invalid file extension."));
			return;
		}
		
	});
}

//API
app.get('/sign-s3', function(req, res) {
	const s3 = new aws.S3();
	const originalFileName = req.query['file-name'];
	const ext = def(originalFileName) ? extRE.exec(originalFileName)[1].toLowerCase() : undefined;
	const fileType = req.query['file-type'];
	const message = req.query['message'];
	const name = req.query['name'];
	const latitude = req.query['latitude'];
	const longitude = req.query['longitude'];
	const zoom = req.query['zoom'];
	const userAgent = req.headers['user-agent'];
	const forwardedAddress = req.headers['x-forwarded-for'];
	const remoteAddress = req.connection.remoteAddress;
	const json = {
		message,
		name,
		latitude,
		longitude,
		zoom,
		userAgent,
		forwardedAddress,
		remoteAddress
	}
	var uniqueId = req.query['unique-id'];
	generateUniqueFileName(s3,ext).then(function(fileName) {
		uniqueId = fallback(uniqueId,fileName);
		json.uniqueId = uniqueId;
		var jsonFileName = fileName + ".json";
		var params = {
			Bucket: S3_BUCKET,
			Key: jsonFileName,
			ContentType: 'application/json',
			Body: JSON.stringify(json),
			ACL: 'public-read'
		}
		s3.putObject(params, function(error,data) {
			if (error) {
				res.json(errdict(error));
				return;
			}
			if (!def(fileType) || !def(ext)) {
				res.json({uniqueId,fileName});
				return;
			}
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
					uniqueId,
					fileName,
					signedRequest: data,
					url: "https://" + S3_BUCKET + ".s3.amazonaws.com/" + fileName
				});
			});
		});
	}, function(error) {
		res.json(errdict(error));
	});
});

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