/*******************************************************************************
  Date: 11/6/15
  Author:  Lee Grey (lee@apigee.com)

  usage:    node proxybundle.js <org> <proxy> <rev>
  example:  node proxybundle.js amer-demo15 Customer360 1

  Downloads and extracts a proxy bundle from Edge using Management APIs.  Turns
  it into a Directed Acyclic Graph (DAG).

  Expects two environment variables:
     APIGEEUN - Org username
     APIGEEPW - Org password
*******************************************************************************/


var needle = require('needle')              // could have been http or request - thought it would handle unzip but it didn't :(
var AdmZip = require('adm-zip')             // handles the unzipping
var xmlparser = require('xml2js').Parser()  // converts XML files to JSON
var express = require('express')
var app = express()

// GLOBALS /////////////////////////////////////////////////////////////////////
var org = process.argv[2] || 'amer-demo15'
var api = process.argv[3] || 'Customer360'
var rev = process.argv[4] || '1'

var url = 'https://api.enterprise.apigee.com/v1/organizations/'+org+'/apis/'+api+'/revisions/'+rev+'?format=bundle'

var zipEntries        // stores the bundle for when needed to build the visualization
var nodes = []        // discovered nodes from bundle
var edges = []        // discovered edges from bundle
var nodeCount = 0     // used to keep all step names unique across all flows

var flowMetadata = {} // holds the return steps from each flow being processed
// GLOBALS /////////////////////////////////////////////////////////////////////


// RETRIEVE PROXY BUNDLE ///////////////////////////////////////////////////////
var options = {
  compressed         : true,        // sets 'Accept-Encoding' to 'gzip,deflate'
  follow_max         : 5,           // follow up to five redirects
  rejectUnauthorized : true,        // verify SSL certificate
  username: process.env.APIGEEUN,
  password: process.env.APIGEEPW
}

needle.get(url, options, function(err, resp, body) {
  var zip = new AdmZip(body)
  zipEntries = zip.getEntries()

  console.log('\n===============================')
  console.log(new Date() + '  ' + zipEntries.length,'files')

  zipEntries.forEach(function(ze) {
    console.log(ze.name,ze.entryName,ze.isDirectory)

    if( ze.entryName.indexOf('apiproxy/policies') >= 0 ) {
      console.log(ze.name,'is a POLICY')
    } else if( ze.entryName.indexOf('apiproxy/proxies') >= 0 ) {
      console.log(ze.name,'is a PROXY')
      xmlparser.parseString(zip.readAsText(ze), function(err, result) {
        console.log('PROXY in JSON:------------------\n', JSON.stringify(result), '\n-------------------------\n')
        var proxy = deconstructProxy(result)
      })
    } else if( ze.entryName.indexOf('apiproxy/targets') >= 0 ) {
      console.log(ze.name,'is a TARGET')
    } else if( ze.entryName.indexOf('apiproxy/resources') >= 0 ) {
      console.log(ze.name,'is a RESOURCE')
    } else if( ze.entryName.indexOf('apiproxy/') >= 0 ) {
      console.log(ze.name,'is an APIProxy')
    }

    if( ze.name.indexOf('.xml') > 0 ) {
      xmlparser.parseString(zip.readAsText(ze), function(err, result) {
      })
    }

    console.log('\n===============================\n')
  })
});


////////////////////////////////////////////////////////////////////////////////
function proxyNodesToViz() {
  return JSON.stringify(nodes)
}

////////////////////////////////////////////////////////////////////////////////
function proxyEdgesToViz() {
  return JSON.stringify(edges)
}


////////////////////////////////////////////////////////////////////////////////
// TODO FaultRules
// TODO RouteRules
// TODO Conditions
// TODO use actual TargetEndpoints

////////////////////////////////////////////////////////////////////////////////
/*
 * Extracts all nodes and edges from a flow
 *
 * flow - an array of steps
 * groupId - string to place all these steps into the same group
 * defaultFirst - id of first node, if none is discovered
 * defaultLast - id of last node, if none is discovered
 */
function processFlow(flow, groupId, defaultFirst, defaultLast) {
  var firstStep
  var lastStep
  var stepCount = 0

  try {
    var prevId
    flow.Step.forEach(function(step) {
      var stepId = step.Name[0]+nodeCount++
      ++stepCount
      console.log('      step', step, stepId, stepCount)
      if( !firstStep ) {
        if( defaultFirst ) {
          edges.push({from:defaultFirst, to:stepId})
        }
        firstStep = stepId
      }
      nodes.push({id:stepId, label:step.Name[0], group:groupId})
      if( prevId ) {
        edges.push({from:prevId, to:stepId})
      }
      prevId = stepId
      lastStep = stepId
    })
    if( defaultLast ) {
      edges.push({from:lastStep, to:defaultLast})
    }
  } catch(e) {
    console.log('exception', e)
  }
  return {firstStep:firstStep, lastStep:lastStep, steps:stepCount}
}


////////////////////////////////////////////////////////////////////////////////
/*
 * Cycles through all PreFlows
 */
function deconstructPreFlows(p) {
  p.ProxyEndpoint.PreFlow.forEach(function(preflow) {
    console.log('  preflow', preflow.$.name)

    // Request
    flowMetadata['PreFlowRequest'] = {firstStep:'PreFlowRequest', lastStep:'PreFlowRequest'}
    preflow['Request'].forEach(function(r) {
      console.log('    request', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata['PreFlowRequest'] = processFlow(r, 'PreFlowRequest', 'request')
      } else {
        nodes.push({id:'PreFlowRequest', label:'Empty Request PreFlow', group:'PreFlowRequest'})
        flowMetadata['PreFlowRequest'].firstStep = 'PreFlowRequest'
        flowMetadata['PreFlowRequest'].lastStep = 'PreFlowRequest'
      }
      console.log('preFlowRequest', flowMetadata['PreFlowRequest'])
    })

    // Response
    flowMetadata['PreFlowResponse'] = {firstStep:'PreFlowResponse', lastStep:'PreFlowResponse'}
    preflow['Response'].forEach(function(r) {
      console.log('    response', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata['PreFlowResponse'] = processFlow(r, 'PreFlowResponse', 'target')
      } else {
        nodes.push({id:'PreFlowResponse', label:'Empty Response PreFlow', group:'PreFlowResponse'})
        flowMetadata['PreFlowResponse'].firstStep = 'PreFlowResponse'
        flowMetadata['PreFlowResponse'].lastStep = 'PreFlowResponse'
      }
      console.log('preFlowResponse', flowMetadata['PreFlowResponse'])
    })
  })
}


////////////////////////////////////////////////////////////////////////////////
/*
 * Cycles through all PostFlows
 */
function deconstructPostFlows(p) {
  p.ProxyEndpoint.PostFlow.forEach(function(postflow) {
    console.log('  postflow', postflow.$.name)

    // Request
    flowMetadata['PostFlowRequest'] = {firstStep:'PostFlowRequest', lastStep:'PostFlowRequest'}
    postflow['Request'].forEach(function(r) {
      console.log('    request', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata['PostFlowRequest'] = processFlow(r, 'PostFlowRequest', null, 'target')
      } else {
        nodes.push({id:'PostFlowRequest', label:'Empty Request PostFlow', group:'PostFlowRequest'})
        flowMetadata['PostFlowRequest'].firstStep = 'PostFlowRequest'
        flowMetadata['PostFlowRequest'].lastStep = 'PostFlowRequest'
      }
    })

    // Response
    flowMetadata['PostFlowResponse'] = {firstStep:'PostFlowResponse', lastStep:'PostFlowResponse'}
    postflow['Response'].forEach(function(r) {
      console.log('    response', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata['PostFlowResponse'] = processFlow(r, 'PostFlowResponse', null, 'response')
      } else {
        nodes.push({id:'PostFlowResponse', label:'Empty Response PostFlow', group:'PostFlowResponse'})
        flowMetadata['PostFlowResponse'].firstStep = 'PostFlowResponse'
        flowMetadata['PostFlowResponse'].lastStep = 'PostFlowResponse'
      }
      console.log('postFlowResponse', flowMetadata['PostFlowResponse'])
    })
  })
}


////////////////////////////////////////////////////////////////////////////////
/*
 * Cycles through all Conditional Flows
 */
function deconstructConditionalFlows(p) {
  p.ProxyEndpoint.Flows.forEach(function(flows) {
    flows.Flow.forEach(function(condflow) {
      console.log('  condflow', condflow.$.name)

      // Request
      condflow['Request'].forEach(function(r) {
        console.log('    request', r, typeof r)
        if( typeof r == 'object' ) {
          flowMetadata[condflow.$.name+'Request'] = processFlow(r, condflow.$.name+'Request', flowMetadata['PreFlowRequest'].lastStep, flowMetadata['PostFlowRequest'].firstStep)
        }
        console.log(condflow.$.name+'Request', flowMetadata[condflow.$.name+'Request'])
      })

      // Response
      condflow['Response'].forEach(function(r) {
        console.log('    response', r, typeof r)
        if( typeof r == 'object' ) {
          flowMetadata[condflow.$.name+'Response'] = processFlow(r, condflow.$.name+'Response', flowMetadata['PreFlowResponse'].lastStep, flowMetadata['PostFlowResponse'].firstStep)
        }
        console.log(condflow.$.name+'Response', flowMetadata[condflow.$.name+'Response'])
      })
    })
  })
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
function deconstructProxy(p) {
  console.log('Proxy name', p.ProxyEndpoint.$.name)

  // add the mile marker nodes
  nodes.push({id:'request', label:'Request', group:'client'})

  // TODO handle multiple ProxyEndpoints
/*
  nodes.push({id:'postFlowRequestStart', label:'Start of PostFlow', group:'PostFlowRequest'})
  nodes.push({id:'postFlowRequestEnd', label:'End of PostFlow', group:'PostFlowRequest'})
*/
  nodes.push({id:'target', label:'Target', group:'targets'})    // TODO handle multiple TargetEndpoints
/*
  nodes.push({id:'preFlowResponseStart', label:'Start of PreFlow', group:'PreFlowResponse'})
  nodes.push({id:'preFlowResponseEnd', label:'End of PreFlow', group:'PreFlowResponse'})
  nodes.push({id:'postFlowResponseStart', label:'Start of PostFlow', group:'PostFlowResponse'})
  nodes.push({id:'postFlowResponseEnd', label:'End of PostFlow', group:'PostFlowResponse'})
*/
  nodes.push({id:'response', label:'Response', group:'client'})


  // assemble individual flows
  deconstructPreFlows(p)
  deconstructPostFlows(p)
  deconstructConditionalFlows(p)


  // connect flows together into a complete graph of the proxy
  try {
    /*
    // preflow request
    if( !flowMetadata['PreFlowRequest'].steps ) {
      flowMetadata['PreFlowRequest'].firstStep = 'request'
      flowMetadata['PreFlowRequest'].lastStep = 'preFlowRequestEnd'
      nodes.push({id:'preFlowRequestStart', label:'Start of PreFlow', group:'PreFlowRequest'})
      nodes.push({id:'preFlowRequestEnd', label:'End of PreFlow', group:'PreFlowRequest'})
      edges.push({from:'preFlowRequestStart', to:'preFlowRequestEnd'})
    } else {
      edges.push({from:'preFlowRequestStart', to:flowMetadata['PreFlowRequest'].firstStep})
      edges.push({from:flowMetadata['PreFlowRequest'].lastStep, to:'preFlowRequestEnd'})
    }
*/
    // conditional flows request
    Object.keys(flowMetadata).forEach(function(key) {
      console.log('key', key)
      if( ['PreFlowRequest', 'PostFlowRequest', 'PreFlowResponse', 'PostFlowResponse'].indexOf(key) === -1 ) {
        console.log('>>>>>>>>>>>>>>>>>>>>>>> process', flowMetadata[key])
        edges.push({from:flowMetadata['PreFlowRequest'].lastStep, to:flowMetadata[key].firstStep})
        edges.push({from:flowMetadata[key].lastStep, to:flowMetadata['PostFlowRequest'].firstStep})
      }
    })
/*
    // postflow request
    edges.push({from:'postFlowRequestEnd', to:'target'})
    edges.push({from:'target', to:preFlowResponse.lastStep})

    edges.push({from:postFlowResponse.lastStep, to:'response'})
    */
  } catch(e) {
    console.log('exception', e)
  }

  console.log('end of dag generation', nodes, edges)
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// handle HTTP stuff ///////////////////////////////////////////////////////////

app.use(express.static('static'))

app.get('/', function(req, res) {
  res.send('try /proxyviz.html ')
})

app.get('/proxyviz.js', function(req, res) {
  var script = '' +
               'document.addEventListener("DOMContentLoaded", function(event) {\n' +
               '  var nodes = new vis.DataSet('+proxyNodesToViz()+')\n' +
               '  var edges = new vis.DataSet('+proxyEdgesToViz()+')\n' +
               '  var container = document.getElementById("proxyviz")\n' +
               '  var data = {nodes: nodes, edges: edges}\n' +
               '  var network = new vis.Network(container, data, {})\n' +
               '  var options = {\n' +
               '    autoResize: true,\n' +
               '    nodes: {shape:"box"},\n' +
               '    interaction: {hover:true},\n' +
               '    physics: {enabled: false},\n' +
               '  }\n' +
               '  network.setOptions(options)\n' +
               '  initializeEventHandlers(network)\n' +
               '})\n' +


  res.setHeader('Content-Type', 'text/javascript')
  res.write(script)
  res.end()
})

var server = app.listen(3000, function() {
  var host = server.address().address
  var port = server.address().port
  console.log('Listening at http://%s:%s', host, port)
})

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
