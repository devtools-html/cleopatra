const hiliteClassName = "histogramHilite";
const kSVGNS = "http://www.w3.org/2000/svg";

function removeAllChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function treeObjSort(a, b) {
  return b.counter - a.counter;
}

function ProfileTreeManager(container) {
  this.treeView = new TreeView();
  this.treeView.setColumns([
    { name: "sampleCount", title: "Running time" },
    { name: "selfSampleCount", title: "Self" },
    { name: "symbolName", title: "Symbol Name"},
  ]);
  var self = this;
  this.treeView.addEventListener("select", function (frameData) {
    self.highlightFrame(frameData);
  });
  this.treeView.addEventListener("contextMenuClick", function (e) {
    self._onContextMenuClick(e);
  });
  this.treeView.addEventListener("focusCallstackButtonClicked", function (frameData) {
    var focusedCallstack = self._getCallstackUpTo(frameData);
    focusOnCallstack(focusedCallstack, frameData.name);
  });
  container.appendChild(this.treeView.getContainer());
}
ProfileTreeManager.prototype = {
  highlightFrame: function Treedisplay_highlightFrame(frameData) {
    setHighlightedCallstack(this._getCallstackUpTo(frameData));
  },
  _getCallstackUpTo: function ProfileTreeManager__getCallstackUpTo(frame) {
    var callstack = [];
    var curr = frame;
    while (curr != null) {
      if (curr.name != null) {
        var subCallstack = curr.fullFrameNamesAsInSample.clone();
        subCallstack.reverse();
        callstack = callstack.concat(subCallstack);
      }
      curr = curr.parent;
    }
    callstack.reverse();
    if (gInvertCallstack)
      callstack.shift(); // remove (total)
    return callstack;
  },
  _onContextMenuClick: function ProfileTreeManager__onContextMenuClick(e) {
    var node = e.node;
    var menuItem = e.menuItem;

    if (menuItem == "View Source") {
      // Remove anything after ( since MXR doesn't handle search with the arguments.
      var symbol = node.name.split("(")[0];
      window.open("http://mxr.mozilla.org/mozilla-central/search?string=" + symbol, "View Source");
    } else if (menuItem == "Google Search") {
      var symbol = node.name;
      window.open("https://www.google.ca/search?q=" + symbol, "View Source");
    } else if (menuItem == "Focus Frame") {
      var symbol = node.fullFrameNamesAsInSample[0]; // TODO: we only function one symbol when callpath merging is on, fix that
      focusOnSymbol(symbol, node.name);
    } else if (menuItem == "Focus Callstack") {
      var focusedCallstack = this._getCallstackUpTo(node);
      focusOnCallstack(focusedCallstack, node.name);
    }
  },
  display: function ProfileTreeManager_display(tree, symbols, functions, useFunctions) {
    this.treeView.display(this.convertToJSTreeData(tree, symbols, functions, useFunctions));
  },
  convertToJSTreeData: function ProfileTreeManager__convertToJSTreeData(rootNode, symbols, functions, useFunctions) {
    var totalSamples = rootNode.counter;
    function createTreeViewNode(node, parent) {
      var curObj = {};
      curObj.parent = parent;
      curObj.counter = node.counter;
      var selfCounter = node.counter;
      for (var i = 0; i < node.children.length; ++i) {
        selfCounter -= node.children[i].counter;
      }
      curObj.selfCounter = selfCounter;
      curObj.ratio = node.counter / totalSamples;
      curObj.fullFrameNamesAsInSample = node.mergedNames ? node.mergedNames : [node.name];
      if (!(node.name in symbols)) {
        curObj.name = node.name;
        curObj.library = "";
      } else {
        var functionObj = useFunctions ? functions[node.name] : functions[symbols[node.name].functionIndex];
        var info = {
          functionName: functionObj.functionName,
          libraryName: functionObj.libraryName,
          lineInformation: useFunctions ? "" : symbols[node.name].lineInformation
        };
        curObj.name = (info.functionName + " " + info.lineInformation).trim();
        curObj.library = info.libraryName;
      }
      if (node.children.length) {
        curObj.children = getChildrenObjects(node.children, curObj);
      }
      return curObj;
    }
    function getChildrenObjects(children, parent) {
      var sortedChildren = children.slice(0).sort(treeObjSort);
      return sortedChildren.map(function (child) {
        return {
          getData: function () { return createTreeViewNode(child, parent); }
        };
      });
    }
    return getChildrenObjects([rootNode], null);
  },
};

// The responsiveness threshold (in ms) after which the sample shuold become
// completely red in the histogram.
var kDelayUntilWorstResponsiveness = 1000;

function HistogramView(markerContainer) {
  this._canvas = this._createCanvas();
  this._rangeSelector = new RangeSelector(markerContainer, this._canvas);
  this._rangeSelector.enableRangeSelectionOnHistogram();
  this._histogramData = [];

}
HistogramView.prototype = {
  _createCanvas: function HistogramView__createSVGRoot() {
    var canvas = document.createElement("canvas");
    canvas.height = 60;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    return canvas;
  },
  getContainer: function HistogramView_getContainer() {
    return this._canvas;
  },
  _gatherMarkersList: function HistogramView__gatherMarkersList(histogramData) {
    var markers = [];
    for (var i = 0; i < histogramData.length; ++i) {
      var step = histogramData[i];
      if ("marker" in step) {
        markers.push({
          index: i,
          name: step.marker
        });
      }
    }
    return markers;
  },
  _calculateWidthMultiplier: function () {
    var minWidth = 2000;
    return Math.ceil(minWidth / this._widthSum);
  },
  display: function HistogramView_display(profile, highlightedCallstack) {
    this._histogramData = this._convertToHistogramData(profile.samples);
    var lastStep = this._histogramData[this._histogramData.length - 1];
    this._widthSum = lastStep.x + lastStep.width;
    this._widthMultiplier = this._calculateWidthMultiplier();
    this._canvas.width = this._widthMultiplier * this._widthSum;
    this._render(highlightedCallstack);
  },
  _render: function HistogramView__render(highlightedCallstack) {
    var ctx = this._canvas.getContext("2d");
    var height = this._canvas.height;
    ctx.setTransform(this._widthMultiplier, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._widthSum, height);

    var self = this;
    this._histogramData.forEach(function plotStep(step) {
      var isSelected = self._isStepSelected(step, highlightedCallstack);
      ctx.fillStyle = isSelected ? "green" : step.color;
      var roundedHeight = Math.round(step.value * height);
      ctx.fillRect(step.x, height - roundedHeight, step.width, roundedHeight);
    });

    var markers = this._gatherMarkersList(this._histogramData);
    this._rangeSelector.display(markers);
    this._finishedRendering = true;
  },
  highlightedCallstackChanged: function HistogramView_highlightedCallstackChanged(highlightedCallstack) {
    this._render(highlightedCallstack);
  },
  _isStepSelected: function HistogramView__isStepSelected(step, highlightedCallstack) {
    if ("marker" in step)
      return false;
    return step.frames.some(function isCallstackSelected(frames) {
      if (frames.length < highlightedCallstack.length ||
          highlightedCallstack.length <= (gInvertCallstack ? 0 : 1))
        return false;

      var compareFrames = frames;
      if (gInvertCallstack) {
        for (var j = 0; j < highlightedCallstack.length; j++) {
          var compareFrameIndex = compareFrames.length - 1 - j;
          if (highlightedCallstack[j] != compareFrames[compareFrameIndex] &&
              compareFrames[compareFrameIndex] != "(root)")
            return false;
        }
      } else {
        for (var j = 0; j < highlightedCallstack.length; j++) {
          var compareFrameIndex = j;
          if (highlightedCallstack[j] != compareFrames[compareFrameIndex] &&
              compareFrames[compareFrameIndex] != "(root)")
            return false;
        }
      }
      return true;
    });
  },
  _getStepColor: function HistogramView__getStepColor(step) {
      if ("responsiveness" in step.extraInfo) {
        var res = step.extraInfo.responsiveness;
        var redComponent = Math.round(255 * Math.min(1, res / kDelayUntilWorstResponsiveness));
        return "rgb(" + redComponent + ",0,0)";
      }

      return "rgb(0,0,0)";
  },
  _convertToHistogramData: function HistogramView_convertToHistogramData(data) {
    var histogramData = [];
    var maxHeight = 0;
    for (var i = 0; i < data.length; ++i) {
      if (!data[i])
        continue;
      var value = data[i].frames.length;
      if (maxHeight < value)
        maxHeight = value;
    }
    maxHeight += 1;
    var nextX = 0;
    // The number of data items per histogramData rects.
    // Except when seperated by a marker.
    // This is used to cut down the number of rects, since
    // there's no point in having more rects then pixels
    var samplesPerStep = Math.floor(data.length / 2000);
    for (var i = 0; i < data.length; i++) {
      var step = data[i];
      if (!step) {
        // Add a gap for the sample that was filtered out.
        nextX += 1;
        continue;
      }
      var value = step.frames.length / maxHeight;
      var frames = step.frames;
      var currHistrogramData = histogramData[histogramData.length-1];
      if ("marker" in step.extraInfo) {
        // A new marker boundary has been discovered.
        histogramData.push({
          frames: "marker",
          x: nextX,
          width: 2,
          value: 1,
          marker: step.extraInfo.marker,
          color: "fuchsia"
        });
        nextX += 2;
        histogramData.push({
          frames: [frames],
          x: nextX,
          width: 1,
          value: value,
          color: this._getStepColor(step),
        });
        nextX += 1;
      } else if (currHistrogramData != null &&
        currHistrogramData.frames.length < samplesPerStep) {
        currHistrogramData.frames.push(frames);
        // When merging data items take the highest frame
        if (value > currHistrogramData.value)
          currHistrogramData.value = value;
        // Merge the colors? For now we keep the first color set.
      } else {
        // A new name boundary has been discovered.
        histogramData.push({
          frames: [frames],
          x: nextX,
          width: 1,
          value: value,
          color: this._getStepColor(step),
        });
        nextX += 1;
      }
    }
    return histogramData;
  },
};

function RangeSelector(container, graph) {
  this.container = container;
  this._graph = graph;
  this._selectedRange = { startX: 0, endX: 0 };
  this._selectedSampleRange = { start: 0, end: 0 };
}
RangeSelector.prototype = {
  display: function RangeSelector_display(markers) {
    var graph = this._graph;
    removeAllChildren(this.container);
    removeAllChildren(markers);

    var select = document.createElement("select");
    select.setAttribute("multiple", "multiple");
    select.setAttribute("size", markers.length);
    this.container.appendChild(select);
    this.selector = select;

    for (var i = 0; i < markers.length; ++i) {
      var marker = markers[i];
      var option = document.createElement("option");
      option.appendChild(document.createTextNode(marker.name));
      option.setAttribute("data-index", marker.index);
      select.appendChild(option);
    }

    try {
      select.removeEventListener("click", select_onChange, false);
    } catch (err) {
    }
    select.addEventListener("change", function select_onChange(e) {
      if (self.changeEventSuppressed) {
        return;
      }

      // look for non-consecutive ranges, and make them consecutive
      var range = [];
      var children = select.childNodes;
      for (var i = 0; i < children.length; ++i) {
        range.push(children[i].selected);
      }
      var begin = -1, end = -1;
      for (var i = 0; i < range.length; ++i) {
        if (begin == -1 && range[i]) {
          begin = i;
        } else if (begin != -1 && range[i]) {
          end = i;
        }
      }
      if (begin > -1) {
        for (var i = begin; i <= end; ++i) {
          children[i].selected = true;
        }
      }
      if (end > -1) {
        for (var i = end + 1; i < children.length; ++i) {
          children[i].selected = false;
        }
      }

      // highlight the range in the histogram
      var prevHilite = document.querySelector("." + hiliteClassName);
      if (prevHilite) {
        prevHilite.parentNode.removeChild(prevHilite);
      }
      const hilitedMarker = "markerHilite";
      var prevMarkerHilite = document.querySelector("#" + hilitedMarker);
      if (prevMarkerHilite) {
        prevMarkerHilite.removeAttribute("id");
        prevMarkerHilite.removeAttribute("style");
      }
      function rect(index) {
        return graph.querySelectorAll(".rect")[children[index].getAttribute("data-index")];
      }
      if (begin > end) {
        // Just highlight the respective marker in the histogram
        rect(begin).setAttribute("id", hilitedMarker);
        rect(begin).setAttribute("style", "fill: red;");
      } else if (end > begin) {
        self.drawHiliteRectangle(rect(begin).getAttribute("x"),
                                 0,
                                 parseFloat(rect(end).getAttribute("width")) +
                                 parseFloat(rect(end).getAttribute("x")) -
                                 parseFloat(rect(begin).getAttribute("x")),
                                 graph.getAttribute("height"));
      }
    }, false);
  },
  drawHiliteRectangle: function RangeSelector_drawHiliteRectangle(x, y, width, height) {
    var hilite = document.querySelector("." + hiliteClassName);
    hilite.style.left = x + "px";
    hilite.style.top = "0";
    hilite.style.width = width + "px";
    hilite.style.height = height + "px";
  },
  clearCurrentRangeSelection: function RangeSelector_clearCurrentRangeSelection() {
    try {
      this.changeEventSuppressed = true;
      var children = this.selector.childNodes;
      for (var i = 0; i < children.length; ++i) {
        children[i].selected = false;
      }
    } finally {
      this.changeEventSuppressed = false;
    }
  },
  enableRangeSelectionOnHistogram: function RangeSelector_enableRangeSelectionOnHistogram() {
    var graph = this._graph;
    var isDrawingRectangle = false;
    var origX, origY;
    var self = this;
    function updateHiliteRectangle(newX, newY) {
      var startX = Math.min(newX, origX) - graph.parentNode.getBoundingClientRect().left;
      var startY = 0;
      var width = Math.abs(newX - origX);
      var height = graph.parentNode.clientHeight;
      self._selectedRange.startX = startX;
      self._selectedRange.endX = startX + width;
      self.drawHiliteRectangle(startX, startY, width, height);
    }
    graph.addEventListener("mousedown", function(e) {
      if (e.button != 0)
        return;
      isDrawingRectangle = true;
      self.beginHistogramSelection();
      origX = e.pageX;
      origY = e.pageY;
      if (this.setCapture)
        this.setCapture();
      // Reset the highlight rectangle
      updateHiliteRectangle(e.pageX, e.pageY);
      e.preventDefault();
    }, false);
    graph.addEventListener("mouseup", function(e) {
      if (isDrawingRectangle) {
        updateHiliteRectangle(e.pageX, e.pageY);
        isDrawingRectangle = false;
        self.finishHistogramSelection(e.pageX != origX);
      }
    }, false);
    graph.addEventListener("mousemove", function(e) {
      if (isDrawingRectangle) {
        updateHiliteRectangle(e.pageX, e.pageY);
      }
    }, false);
  },
  beginHistogramSelection: function RangeSelector_beginHistgramSelection() {
    var hilite = document.querySelector("." + hiliteClassName);
    hilite.classList.remove("finished");
    hilite.classList.add("selecting");
    hilite.classList.remove("collapsed");
    if (this._transientRestrictionEnteringAffordance) {
      this._transientRestrictionEnteringAffordance.discard();
    }
  },
  finishHistogramSelection: function RangeSelector_finishHistgramSelection(isSomethingSelected) {
    var self = this;
    var hilite = document.querySelector("." + hiliteClassName);
    hilite.classList.remove("selecting");
    if (isSomethingSelected) {
      hilite.classList.add("finished");
      var start = this._sampleIndexFromPoint(this._selectedRange.startX);
      var end = this._sampleIndexFromPoint(this._selectedRange.endX);
      var newFilterChain = gSampleFilters.concat([new RangeSampleFilter(start, end)]);
      self._transientRestrictionEnteringAffordance = gNestedRestrictions.add({
        title: "Sample Range [" + start + ", " + (end + 1) + "]",
        enterCallback: function () {
          gSampleFilters = newFilterChain;
          self.collapseHistogramSelection();
          refreshUI();
        }
      });
    } else {
      hilite.classList.add("collapsed");
    }
  },
  collapseHistogramSelection: function RangeSelector_collapseHistogramSelection() {
    var hilite = document.querySelector("." + hiliteClassName);
    hilite.classList.add("collapsed");
  },
  _sampleIndexFromPoint: function RangeSelector__sampleIndexFromPoint(x) {
    // XXX this is completely wrong, fix please
    var totalSamples = parseFloat(gCurrentlyShownSampleData.samples.length);
    var width = parseFloat(this._graph.parentNode.clientWidth);
    var factor = totalSamples / width;
    return parseInt(parseFloat(x) * factor);
  },
};

function FocusedFrameSampleFilter(focusedSymbol) {
  this._focusedSymbol = focusedSymbol;
}
FocusedFrameSampleFilter.prototype = {
  filter: function FocusedFrameSampleFilter_filter(profile) {
    return Parser.filterBySymbol(profile, this._focusedSymbol);
  },
};

function FocusedCallstackPrefixSampleFilter(focusedCallstack) {
  this._focusedCallstackPrefix = focusedCallstack;
}
FocusedCallstackPrefixSampleFilter.prototype = {
  filter: function FocusedCallstackPrefixSampleFilter_filter(profile) {
    return Parser.filterByCallstackPrefix(profile, this._focusedCallstackPrefix);
  }
};

function FocusedCallstackPostfixSampleFilter(focusedCallstack) {
  this._focusedCallstackPostfix = focusedCallstack;
}
FocusedCallstackPostfixSampleFilter.prototype = {
  filter: function FocusedCallstackPostfixSampleFilter_filter(profile) {
    return Parser.filterByCallstackPostfix(profile, this._focusedCallstackPostfix);
  }
};

function BreadcrumbTrail() {
  this._breadcrumbs = [];
  this._selectedBreadcrumbIndex = -1;

  this._containerElement = document.createElement("ol");
  this._containerElement.className = "breadcrumbTrail";
  var self = this;
  this._containerElement.addEventListener("click", function (e) {
    if (!e.target.classList.contains("breadcrumbTrailItem"))
      return;
    self._enter(e.target.breadcrumbIndex);
  });
}
BreadcrumbTrail.prototype = {
  getContainer: function BreadcrumbTrail_getContainer() {
    return this._containerElement;
  },
  /**
   * Add a breadcrumb. The breadcrumb parameter is an object with the following
   * properties:
   *  - title: The text that will be shown in the breadcrumb's button.
   *  - enterCallback: A function that will be called when entering this
   *                   breadcrumb.
   */
  add: function BreadcrumbTrail_add(breadcrumb) {
    for (var i = this._breadcrumbs.length - 1; i > this._selectedBreadcrumbIndex; i--) {
      var rearLi = this._breadcrumbs[i];
      if (!rearLi.breadcrumbIsTransient)
        throw "Can only add new breadcrumbs if after the current one there are only transient ones."
      rearLi.breadcrumbDiscarder.discard();
    }
    var li = document.createElement("li");
    li.className = "breadcrumbTrailItem";
    li.textContent = breadcrumb.title;
    var index = this._breadcrumbs.length;
    li.breadcrumbIndex = index;
    li.breadcrumbEnterCallback = breadcrumb.enterCallback;
    li.breadcrumbIsTransient = true;
    li.style.zIndex = 1000 - index;
    this._containerElement.appendChild(li);
    this._breadcrumbs.push(li);
    if (index == 0)
      this._enter(index);
    var self = this;
    li.breadcrumbDiscarder = {
      discard: function () {
        if (li.breadcrumbIsTransient) {
          self._deleteBeyond(index - 1);
          delete li.breadcrumbIsTransient;
          delete li.breadcrumbDiscarder;
        }
      }
    };
    return li.breadcrumbDiscarder;
  },
  addAndEnter: function BreadcrumbTrail_addAndEnter(breadcrumb) {
    var removalHandle = this.add(breadcrumb);
    this._enter(this._breadcrumbs.length - 1);
  },
  _enter: function BreadcrumbTrail__select(index) {
    if (index == this._selectedBreadcrumbIndex)
      return;
    var prevSelected = this._breadcrumbs[this._selectedBreadcrumbIndex];
    if (prevSelected)
      prevSelected.classList.remove("selected");
    var li = this._breadcrumbs[index];
    if (!li)
      console.log("li at index " + index + " is null!");
    delete li.breadcrumbIsTransient;
    li.classList.add("selected");
    this._deleteBeyond(index);
    this._selectedBreadcrumbIndex = index;
    li.breadcrumbEnterCallback();
  },
  _deleteBeyond: function BreadcrumbTrail__deleteBeyond(index) {
    while (this._breadcrumbs.length > index + 1) {
      this._hide(this._breadcrumbs[index + 1]);
      this._breadcrumbs.splice(index + 1, 1);
    }
  },
  _hide: function BreadcrumbTrail__hide(breadcrumb) {
    delete breadcrumb.breadcrumbIsTransient;
    breadcrumb.classList.add("deleted");
    setTimeout(function () {
      breadcrumb.parentNode.removeChild(breadcrumb);
    }, 1000);
  },
};

function maxResponsiveness() {
  var data = gCurrentlyShownSampleData.samples;
  var maxRes = 0.0;
  for (var i = 0; i < data.length; ++i) {
    if (!data[i] || !data[i].extraInfo["responsiveness"])
      continue;
    if (maxRes < data[i].extraInfo["responsiveness"])
      maxRes = data[i].extraInfo["responsiveness"];
  }
  return maxRes;
}

function numberOfCurrentlyShownSamples() {
  var data = gCurrentlyShownSampleData.samples;
  var num = 0;
  for (var i = 0; i < data.length; ++i) {
    if (data[i])
      num++;
  }
  return num;
}

function avgResponsiveness() {
  var data = gCurrentlyShownSampleData.samples;
  var totalRes = 0.0;
  for (var i = 0; i < data.length; ++i) {
    if (!data[i] || !data[i].extraInfo["responsiveness"])
      continue;
    totalRes += data[i].extraInfo["responsiveness"];
  }
  return totalRes / numberOfCurrentlyShownSamples();
}

function copyProfile() {
  window.prompt ("Copy to clipboard: Ctrl+C, Enter", document.getElementById("data").value);
}

function downloadProfile() {
  var bb = new MozBlobBuilder();
  bb.append(gRawProfile);
  var blob = bb.getBlob("application/octet-stream");
  location.href = window.URL.createObjectURL(blob);
}

function uploadProfile(selected) {
  var oXHR = new XMLHttpRequest();
  oXHR.open("POST", "http://profile-logs.appspot.com/store", true);
  oXHR.onload = function (oEvent) {
    if (oXHR.status == 200) {  
      document.getElementById("upload_status").innerHTML = document.URL.split('?')[0] + "?report=" + oXHR.responseText;
    } else {  
      document.getElementById("upload_status").innerHTML = "Error " + oXHR.status + " occurred uploading your file.";
    }  
  };

  var dataToUpload;
  var dataSize;
  if (selected === true) {
    dataToUpload = getTextData();
  } else {
    dataToUpload = gRawProfile;
  }

  if (dataToUpload.length > 1024*1024) {
    dataSize = (dataToUpload.length/1024/1024) + " MB(s)";
  } else {
    dataSize = (dataToUpload.length/1024) + " KB(s)";
  }

  var formData = new FormData();
  formData.append("file", dataToUpload);
  document.getElementById("upload_status").innerHTML = "Uploading Profile (" + dataSize + ")";
  oXHR.send(formData);

}

function populate_skip_symbol() {
  var skipSymbolCtrl = document.getElementById('skipsymbol')
  //skipSymbolCtrl.options = gSkipSymbols;
  for (var i = 0; i < gSkipSymbols.length; i++) {
    var elOptNew = document.createElement('option');
    elOptNew.text = gSkipSymbols[i];
    elOptNew.value = gSkipSymbols[i];
    elSel.add(elOptNew);
  }
    
}

function delete_skip_symbol() {
  var skipSymbol = document.getElementById('skipsymbol').value
}

function add_skip_symbol() {
  
}

var gFilterChangeCallback = null;
function filterOnChange() {
  if (gFilterChangeCallback != null) {
    clearTimeout(gFilterChangeCallback);
    gFilterChangeCallback = null;
  }

  gFilterChangeCallback = setTimeout(filterUpdate, 200); 
}
function filterUpdate() {
  gFilterChangeCallback = null;

  refreshUI(); 

  filterNameInput = document.getElementById("filterName");
  if (filterNameInput != null) {
    filterNameInput.focus();
  } 
}

// Maps document id to a tooltip description
var tooltip = {
  "mergeFunctions" : "Ignore line information and merge samples based on function names.",
  "showJank" : "Show only samples with >50ms responsiveness.",
  //"mergeUnvranch" : "???",
  "filterName" : "Show only samples with a frame containing the filter as a substring.",
  "invertCallstack" : "Invert the callstack (Heavy view) to find the most expensive leaf functions.",
  "upload" : "Upload the full profile to public cloud storage to share with others.",
  "upload_select" : "Upload only the selected view.",
  "download" : "Initiate a download of the full profile.",
}

function addTooltips() {
  for (var elemId in tooltip) {
    var elem = document.getElementById(elemId); 
    if (elem == null) continue;
    elem.title = tooltip[elemId];
  }
}

function updateDescription() {
  // Temporary until fileListItem are built correctly
  var sampleCount = document.getElementById("fileListItemSamples");
  sampleCount.innerHTML = gParsedProfile.samples.length;

  var infobar = document.getElementById("infobar");
  var infoText = "";
  
  infoText += "<h2>Selection Info</h2>\n<ul>\n";
  infoText += "  <li>Avg. Responsiveness:<br>" + avgResponsiveness().toFixed(2) + "ms</li>\n";
  infoText += "  <li>Max Responsiveness:<br>" + maxResponsiveness().toFixed(2) + "ms</li>\n";
  infoText += "</ul>\n";
  infoText += "<h2>Pre Filtering</h2>\n";
  infoText += "<label><input type='checkbox' id='mergeFunctions' " + (gMergeFunctions ?" checked='true' ":" ") + " onchange='toggleMergeFunctions()'/>Functions, not lines</label><br>\n";

  var filterNameInputOld = document.getElementById("filterName");
  infoText += "Filter:\n";
  infoText += "<input type='text' id='filterName' oninput='filterOnChange()'/><br>\n";

  infoText += "<h2>Post Filtering</h2>\n";
  infoText += "<label><input type='checkbox' id='showJank' " + (gJankOnly ?" checked='true' ":" ") + " onchange='toggleJank()'/>Show Jank only</label><br>\n";
  infoText += "<h2>View Options</h2>\n";
  infoText += "<label><input type='checkbox' id='mergeUnbranched' " + (gMergeUnbranched ?" checked='true' ":" ") + " onchange='toggleMergeUnbranched()'/>Merge unbranched call paths</label><br>\n";
  infoText += "<label><input type='checkbox' id='invertCallstack' " + (gInvertCallstack ?" checked='true' ":" ") + " onchange='toggleInvertCallStack()'/>Invert callstack</label><br>\n";

  infoText += "<h2>Share</h2>\n";
  infoText += "<a id='upload_status'>No upload in progress</a><br>\n";
  infoText += "<input type='button' id='upload' value='Upload full profile'>\n";
  infoText += "<input type='button' id='upload_select' value='Upload view'><br>\n";
  infoText += "<input type='button' id='download' value='Download full profile'><br>\n";

  //infoText += "<br>\n";
  //infoText += "Skip functions:<br>\n";
  //infoText += "<select size=8 id='skipsymbol'></select><br />"
  //infoText += "<input type='button' id='delete_skipsymbol' value='Delete'/><br />\n";
  //infoText += "<input type='button' id='add_skipsymbol' value='Add'/><br />\n";
  
  infobar.innerHTML = infoText;
  addTooltips();

  var filterNameInputNew = document.getElementById("filterName");
  if (filterNameInputOld != null && filterNameInputNew != null) {
    filterNameInputNew.parentNode.replaceChild(filterNameInputOld, filterNameInputNew);
    //filterNameInputNew.value = filterNameInputOld.value;
  }
  document.getElementById('upload').onclick = uploadProfile;
  document.getElementById('download').onclick = downloadProfile;
  document.getElementById('upload_select').onclick = function() {
    uploadProfile(true);
  };
  //document.getElementById('delete_skipsymbol').onclick = delete_skip_symbol;
  //document.getElementById('add_skipsymbol').onclick = add_skip_symbol;

  //populate_skip_symbol();
}

var gRawProfile = "";
var gParsedProfile = {};
var gHighlightedCallstack = [];
var gTreeManager = null;
var gNestedRestrictions = null;
var gHistogramView = null;
var gCurrentlyShownSampleData = null;
var gSkipSymbols = ["test2", "test1"];

function RangeSampleFilter(start, end) {
  this._start = start;
  this._end = end;
}
RangeSampleFilter.prototype = {
  filter: function RangeSampleFilter_filter(profile) {
    return {
      symbols: profile.symbols,
      functions: profile.functions,
      samples: profile.samples.slice(this._start, this._end)
    };
  }
}

function getTextData() {
  var data = [];
  var samples = gCurrentlyShownSampleData.samples;
  for (var i = 0; i < samples.length; i++) {
    data.push(samples[i].lines.join("\n"));
  }
  return data.join("\n");
}

function loadProfileFile(fileList) {
  if (fileList.length == 0)
    return;
  var file = fileList[0];
  var reader = new FileReader();
  reader.onloadend = function () {
    loadProfile(reader.result, enterMainUI);
  };
  reader.readAsText(file, "utf-8");
}

function loadProfile(rawProfile, finishCallback) {
  gRawProfile = rawProfile;
  var startTime = Date.now();
  gParsedProfile = Parser.parse(rawProfile, function (parsedProfile) {
    console.log("parse time: " + (Date.now() - startTime) + "ms");
    gParsedProfile = parsedProfile;
    finishCallback();
  });
}

var gInvertCallstack = false;
function toggleInvertCallStack() {
  gInvertCallstack = !gInvertCallstack;
  var startTime = Date.now();
  refreshUI();
  console.log("invert time: " + (Date.now() - startTime) + "ms");
}

var gMergeUnbranched = false;
function toggleMergeUnbranched() {
  gMergeUnbranched = !gMergeUnbranched;
  refreshUI(); 
}

var gMergeFunctions = true;
function toggleMergeFunctions() {
  gMergeFunctions = !gMergeFunctions;
  refreshUI(); 
}

var gJankOnly = false;
var gJankThreshold = 50 /* ms */;
function toggleJank(/* optional */ threshold) {
  // Currently we have no way to change the threshold in the UI
  // once we add this we will need to change the tooltip.
  gJankOnly = !gJankOnly;
  if (threshold != null ) {
    gJankThreshold = threshold;
  }
  refreshUI();
}

var gSampleFilters = [];
function focusOnSymbol(focusSymbol, name) {
  var newFilterChain = gSampleFilters.concat([new FocusedFrameSampleFilter(focusSymbol)]);
  gNestedRestrictions.addAndEnter({
    title: name,
    enterCallback: function () {
      gSampleFilters = newFilterChain;
      refreshUI();
    }
  });
}

function focusOnCallstack(focusedCallstack, name) {
  var filter = gInvertCallstack ?
    new FocusedCallstackPostfixSampleFilter(focusedCallstack) :
    new FocusedCallstackPrefixSampleFilter(focusedCallstack);
  var newFilterChain = gSampleFilters.concat([filter]);
  gNestedRestrictions.addAndEnter({
    title: name,
    enterCallback: function () {
      gSampleFilters = newFilterChain;
      refreshUI();
    }
  })
}

function setHighlightedCallstack(samples) {
  gHighlightedCallstack = samples;
  gHistogramView.highlightedCallstackChanged(gHighlightedCallstack);
  updateDescription();
}

function enterMainUI() {
  document.getElementById("dataentry").className = "hidden";
  document.getElementById("ui").className = "";
  gTreeManager = new ProfileTreeManager(document.getElementById("tree"));

  gHistogramView = new HistogramView(document.getElementById("markers"));
  document.getElementById("histogram").appendChild(gHistogramView.getContainer());

  gNestedRestrictions = new BreadcrumbTrail();
  gNestedRestrictions.add({
    title: "Complete Profile",
    enterCallback: function () {
      gSampleFilters = [];
      refreshUI();
    }
  })
  document.getElementById("mainarea").appendChild(gNestedRestrictions.getContainer());

}

function refreshUI() {
  var start = Date.now();
  var data = gParsedProfile;
  console.log("visible range filtering: " + (Date.now() - start) + "ms.");
  start = Date.now();

  if (gMergeFunctions) {
    data = Parser.discardLineLevelInformation(data);
    console.log("line information discarding: " + (Date.now() - start) + "ms.");
    start = Date.now();
  }
  var filterNameInput = document.getElementById("filterName");
  if (filterNameInput != null && filterNameInput.value != "") {
    data = Parser.filterByName(data, document.getElementById("filterName").value);
  }
  for (var i = 0; i < gSampleFilters.length; i++) {
    data = gSampleFilters[i].filter(data);
  }
  if (gJankOnly) {
    data = Parser.filterByJank(data, gJankThreshold);
  }
  gCurrentlyShownSampleData = data;
  var treeData = Parser.convertToCallTree(data, gInvertCallstack);
  console.log("conversion to calltree: " + (Date.now() - start) + "ms.");
  start = Date.now();
  if (gMergeUnbranched) {
    Parser.mergeUnbranchedCallPaths(treeData);
  }
  gTreeManager.display(treeData, data.symbols, data.functions, gMergeFunctions);
  console.log("tree displaying: " + (Date.now() - start) + "ms.");
  start = Date.now();
  gHistogramView.display(data, gHighlightedCallstack);
  console.log("histogram displaying: " + (Date.now() - start) + "ms.");
  start = Date.now();
  updateDescription();
}
