var path = require('path');
var webpack = require('webpack');
 
module.exports = {
  entry: {
    main:'./src/main.js',
    "submissions/submissions":'./src/submissions.js',
  },
  output: { path: './public', filename: '[name].entry.js' },
  module: {
    loaders: [
      {
        include: /\.json$/,
        loaders: ["json-loader"]
      },
      {
        test: /.js?$/,
        loader: 'babel-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['', '.js', '.json'] 
  }
};