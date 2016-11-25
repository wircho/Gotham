import React from 'react';
import ReactDOM from 'react-dom';
import { connect } from 'react-redux';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import Immutable from 'immutable';
var classNames = require('classnames');
import $ from 'jquery';
import 'jquery-form';
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

// Local utilities
function nullFallback(x,y) {
  if (def(x) && x !== null) {
    return x;
  }
  return y;
}

function emptyFallback(x,y) {
  if (def(x) && x !== null && x !== "") {
    return x;
  }
  return y;
}

function getLocation() {
  return new Promise(function(resolve,reject) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function(location) {
        resolve({latitude:location.coords.latitude,longitude:location.coords.longitude});
      },
      function(error) {
        switch(error.code) {
          case error.PERMISSION_DENIED:
            reject(err("User denied the request for Geolocation."));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(err("Location information is unavailable."));
            break;
          case error.TIMEOUT:
            reject(err("The request to get user location timed out."));
            break;
          case error.UNKNOWN_ERROR:
            reject(err("An unknown error occurred."));
            break;
        }
      });
    } else {
      reject(err("Not supported"));
    }
  });
}

function apiReq(dict) {
  return new Promise(function(res,rej) {
    $.ajax(mutate({
      method:"GET",
      dataType:"json",
      success:function(json) {
        var error = geterr(json);
        if (def(error)) {
          rej(error);
          return;
        }
        res(json);
      },
      error:function(xhr,status,error) {
        rej(err(error));
      }
    },dict));
  });
}

function storageAvailable(type) {
  try {
    var storage = window[type],
    x = '__storage_test__';
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  }
  catch(e) {
    return false;   
  }
}

var submittedMessagesKey = 'submittedMessages';
var closedBubbleKey = 'bubbleIsClosed';

function storeMessageData(data) {
  if (storageAvailable('localStorage')) {
    var array = JSON.parse(nullFallback(localStorage.getItem(submittedMessagesKey),"[]"));
    array.push(data);
    localStorage.setItem(submittedMessagesKey,JSON.stringify(array));
  }
}

const ACTIONS = {
  SET_FILES:"SET_FILES", // Takes one array var files
  UPDATE_CONTENT:"UPDATE_CONTENT" // Takes fileName and content
}

// Redux model
/*
{
  files:[
    {fileName:...,url:...,date:...},
    {fileName:...,url:...,date:...},
    ...
  ],
  contents:{
    fileName1:...
    fileName2:...
  }
}
*/

// Actions creators
const setFiles = files=>({type:ACTIONS.SET_FILES,files});
const updateContent = (fileName,content)=>({type:ACTIONS.UPDATE_CONTENT,fileName,content})

// Reducer
const initialState = {};
function app(state,action) {
  if (!def(state)) {
    return initialState
  }
  switch (action.type) {
    case ACTIONS.SET_FILES:
      return mutate(state,{files:action.files,contents:{}})
      break;
    case ACTIONS.UPDATE_CONTENT:
      var update = {};
      update[action.fileName] = action.content;
      return mutate(state,{contents:mutate(state.contents,update)});
      break;
  }
}

// Map state to props
const mapStateToProps = state=>state;

const mapDispatchToProps = (dispatch) => ({
  updateComponentContent: function(fileName,content) {
    dispatch(updateContent(fileName,content))
  }
});

//React classes
const App = React.createClass({
  render: function() {
    if (this.props.files) {
      var items = this.props.files.map(function(file) {
        return <Item key={file.fileName} date={file.date} fileName={file.fileName} url={file.url} content={this.props.contents[file.fileName]} updateComponentContent={this.props.updateComponentContent}/>
      }.bind(this));
      return (
        <div><h1>CHER MTL,</h1><ul>{items}</ul></div>
      );
    }else {
      return (
        <div id="outer-content">Loading</div>
      );
    }
    
  }
});

function makeLocationURL(latitude,longitude,zoom) {
  return "http://maps.google.com/maps?q=" + latitude + "," + longitude + (def(zoom) ? ("&z=" + zoom) : "");
}

const Item = React.createClass({
  componentDidMount: function() {
    if (!def(this.props.content)) {
      apiReq({url:this.props.url}).then(function(json) {
        this.props.updateComponentContent(this.props.fileName,json);
      }.bind(this), function(error) {
        console.log("Error: " + errstr(error));
      }.bind(this));
    }
  },
  render: function() {
    if (def(this.props.content)) {
      var message = emptyFallback(this.props.content.message,"(empty)");
      var name = emptyFallback(this.props.content.name,"(no name)");
      var uniqueId = emptyFallback(this.props.content.uniqueId,"no unique id");
      var latitude = this.props.content.latitude;
      var longitude = this.props.content.longitude;
      var zoom = this.props.content.zoom;
      var imageURL = this.props.url.slice(0, -5);
      var locationURL = (def(latitude) && def(longitude)) ? makeLocationURL(latitude,longitude,zoom) : undefined;
      var date = this.props.date;
      return (
        <li>
          <b><a href={imageURL} target="_blank">Image Link</a> | <a href={locationURL} target="_blank">Location Link</a></b><br/>
          <br/><b>Sent:</b><br/>
          {date}<br/>
          <br/><b>Message:</b><br/>
          {message}<br/>
          <br/><b>Name:</b><br/>
          {name} ({uniqueId})<br/>
          <br/>
        </li>
      );
    }else {
      return (
        <li>Loading {this.props.url}...</li>
      );
    }
  }
});

//React / Redux connection and render
const store = createStore(app);
const VisibleApp = connect(mapStateToProps,mapDispatchToProps)(App);
ReactDOM.render(
  <Provider store={store}><VisibleApp /></Provider>,
  document.getElementById('content')
);

apiReq({url:"/all-submissions"}).then(function(array) {
  store.dispatch(setFiles(array));
}, function(error) {
  alert("Something went wrong. Please refresh. " + errstr(error));
})
