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
  nullFallback,
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

var isDragAndDropSupported = function() {
  var div = document.createElement('div');
  return (('draggable' in div) || ('ondragstart' in div && 'ondrop' in div)) && 'FormData' in window && 'FileReader' in window;
}();

// API
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

function uploadFileData(fileData) {
  var file = (def(fileData) && fileData !== null) ? fileData : undefined;
  var data = {};
  if (def(file)) {
    data.name = file.name;
    data.type = file.type;
  }
  return new Promise(function(res,rej) {
    if (!def(file) || !def(data.name) || !def(data.type)) {
      rej(err("Bad file data."));
      return;
    }
    apiReq({url:"/sign-s3",data}).then(function(json) {
      var signedRequest = json.signedRequest;
      var url = json.url;
      var fileName = json.fileName;
      if (!def(signedRequest) || !def(url)) {
        rej(err("Failed to get S3 signed request or file URL."));
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedRequest);
      xhr.onreadystatechange = () => {
        if(xhr.readyState === 4){
          if(xhr.status === 200){
            res({url});
          } else{
            rej(err("Failed to upload image file."));
          }
        }
      };
      xhr.send(file);
    },rej);
  });
}

function getImageInfo(url) {
  return apiReq({url:"/info",data:{url}});
}

// Constants

const ACTIONS = {
  START_LOADING:"START_LOADING", // No params
  SET_INFO:"SET_INFO", // info: { tags:  [{name:"...", value:0.98}, ...], cats: [{name:"...", value:0.98}, ...] }
}

// Redux model
/*
{
  loading: Boolean,
  info: {
    cats: [
      {name:"...", value:0.98},
      {name:"...", value:0.65},
      ...
    ]
    tags: [
      {name:"...", value:0.98},
      {name:"...", value:0.65},
      ...
    ]
  }
}
*/

// Actions creators
const startLoading = ()=>({type:ACTIONS.START_LOADING});
const setInfo = info=>({type:ACTIONS.SET_INFO,info});

// Reducer
const initialState = {};
const clearState = {}; // bubble_is_closed will be persisted anyway
function app(state,action) {
  if (!def(state)) {
    return initialState
  }
  switch (action.type) {
    case ACTIONS.SET_INFO:
      var newState = remove(state,"loading");
      if (def(action.info)) {
        return mutate(newState,{info:action.info});
      }else {
        return remove(newState,"info");
      }
      break;
    case ACTIONS.START_LOADING:
      return mutate(state,{loading:true});
      break;
  }
}

// Map state to props
const mapStateToProps = state=>state;

const mapDispatchToProps = (dispatch) => ({
  uploadImage: (file) => {
    dispatch(startLoading());
    uploadFileData(file).then(function(json) {
      getImageInfo(json.url).then(function(json) {
        dispatch(setInfo(json));
      },function(error) {
        alert("Something went wrong while processing image: " + errstr(error));
        dispatch(setInfo());
      });
    },function(error) {
      alert("Something went wrong while uploading image: " + errstr(error));
      dispatch(setInfo());
    });
  }
});

//React classes
const App = React.createClass({
  render: function() {
    var tags = def(this.props.info) ? this.props.info.tags : undefined;
    var cats = def(this.props.info) ? this.props.info.cats : undefined;
    return (
      <div id="inner-content">
        <ImageBox loading={this.props.loading} uploadImage={this.props.uploadImage}/>
        <Info loading={this.props.loading} tags={tags} cats={cats}/>
      </div>
    )
    
  }
});

const ImageBox = React.createClass({
  componentDidMount: function() {
    var $form = $("#image-box");
    var preview = $("#image-preview")[0];
    var $input = $("#image-file");
    var imageBoxComponent = this;
    var processFiles = function(files) {
      var imageType = /^image\//;
      if (files.length == 0) {
        return;
      }
      var file = files[0];
      if (!imageType.test(file.type)) {
        alert("Wrong file type. Please provide an image.");
        return;
      }
      preview.file = file;
      var reader = new FileReader();
      reader.onload = (function(aImg) { return function(e) { aImg.src = e.target.result; }; })(preview);
      reader.readAsDataURL(file);
      $form.removeClass("without-image");
      $form.addClass("with-image");
      imageBoxComponent.props.uploadImage(file);
    }
    if (isDragAndDropSupported) {
      $form.on('drag dragstart dragend dragover dragenter dragleave drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
      })
      .on('dragover dragenter', function() {
        $form.addClass('dragging');
      })
      .on('dragleave dragend drop', function() {
        $form.removeClass('dragging');
      })
      .on('drop', function(e) {
        if (imageBoxComponent.props.loading) {
          return;
        }
        var files = e.originalEvent.dataTransfer.files;
        processFiles(files);
      });
    }
    $form.on("change","#image-file",function() {
      var files = $input[0].files;
      processFiles(files);
    });
  },
  render: function() {
    return (
      <div id="image-box-container">
        <form id="image-box" className="without-image">
          <img id="image-preview"/>
          <div id="image-box-content">
            <label id="image-cabinet" htmlFor="image-file" className={classNames({"disabled":this.props.loading})}>
              <input id="image-file" type="file" name="files[]"/>
            </label>
          </div>
        </form>
      </div>
    )
  }
});

const Info = React.createClass({
  render: function() {
    if (this.props.loading || !def(this.props.tags) || !def(this.props.cats) || this.props.tags.length === 0 || this.props.cats.length === 0) {
      return <div></div>
    }

    var trs = [];
    for (var i=0; i<this.props.cats.length; i+=1) {
      var cat = this.props.cats[i];
      var key = "tag " + i;
      //trs.push(<tr key={key}><td className={classNames({highlighted:i<=0})}>{cat["name"]}</td><td>{cat["value"]}</td></tr>);
      var cls = classNames({topcat:i===0,anycat:i!==0});
      trs.push(<div key={key} className={cls}>{cat["name"]}</div>);
    }

    var ttrs = [];
    for (var i=0; i<this.props.tags.length; i+=1) {
      var tag = this.props.tags[i];
      var key = "tag " + i;
      //ttrs.push(<tr key={key}><td>{tag["name"]}</td><td>{tag["value"]}</td></tr>);
      ttrs.push(<div key={key}># {tag["name"]}</div>);
    }

    return (
      <div id="tags">
        <div className="catlist">{trs}</div>
        <div className="taglist">{ttrs}</div>
      </div>
    )
  }
});

//React / Redux connection and render
const store = createStore(app);
const VisibleApp = connect(mapStateToProps,mapDispatchToProps)(App);
ReactDOM.render(
  <Provider store={store}><VisibleApp /></Provider>,
  document.getElementById('content')
);
