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

////////////////////////////////////////////////////////////////////////////////
// TODO FaultRules
// TODO RouteRules
// TODO Conditions
// TODO use actual TargetEndpoints
////////////////////////////////////////////////////////////////////////////////


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
loadBundle = function() {
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
          var proxy = processProxy(result)
        })
      } else if( ze.entryName.indexOf('apiproxy/targets') >= 0 ) {
        console.log(ze.name,'is a TARGET')
        xmlparser.parseString(zip.readAsText(ze), function(err, result) {
          console.log('TARGET in JSON:------------------\n', JSON.stringify(result), '\n-------------------------\n')
          var proxy = processTarget(result)
        })
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
  })
}()


////////////////////////////////////////////////////////////////////////////////
function proxyNodesToViz() {
  return JSON.stringify(nodes)
}

////////////////////////////////////////////////////////////////////////////////
function proxyEdgesToViz() {
  return JSON.stringify(edges)
}

////////////////////////////////////////////////////////////////////////////////
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
    if( lastStep && defaultLast ) {
      edges.push({from:lastStep, to:defaultLast})     // if flow contains steps
    } else if( defaultFirst && defaultLast ) {
      edges.push({from:defaultFirst, to:defaultLast}) // if flow is empty
    }
  } catch(e) {
    console.log('exception', e)
  }
  return {firstStep:firstStep, lastStep:lastStep, steps:stepCount}
}


////////////////////////////////////////////////////////////////////////////////
/*
 * Cycles through all Pre-or-Post-Flows
 *
 * ep - JSON Proxy or Target Endpoint representation
 * pid - namespace-like string to prevent naming collisions on steps
 * pp - Pre or Post to identity which flow
 * rr - Request or Response to identify which flow
 * defaultFirst - id of first node, if none is discovered
 * defaultLast - id of last node, if none is discovered
 */
function processPrePostFlows(ep, pid, pp, rr, defaultFirst, defaultLast) {
  var ids = []
  var flows = eval('ep.'+pp+'Flow')
  flows.forEach(function(flow) {
    var id = pid + pp + 'Flow' + rr + flow.$.name
    ids.push(id)
    console.log('  flow ', flow.$.name, 'identifier', id)
    flowMetadata[id] = {firstStep:id, lastStep:id}

    flow[rr].forEach(function(r) {
      console.log('ReqRes:', rr, r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata[id] = processFlow(r, id, defaultFirst, defaultLast)
      } else {
        nodes.push({id:id, label:'Empty '+rr+' '+pp+'Flow', group:id})
        flowMetadata[id].firstStep = id
        flowMetadata[id].lastStep = id
        flowMetadata[id].steps = 0
        if( defaultFirst && defaultLast ) {
          edges.push({from:defaultFirst, to:defaultLast})
        }
      }
      console.log('flowMetadata:', id, flowMetadata[id])
    })
  })
  return ids
}


////////////////////////////////////////////////////////////////////////////////
/*
 * Cycles through all PreFlows
 * /
function processPreFlows(p, id, defaultFirst, defaultLast) {
  p.PreFlow.forEach(function(preflow) {
    console.log('  preflow', preflow.$.name)

    // Request
    flowMetadata[id+'PreFlowRequest'] = {firstStep:id+'PreFlowRequest', lastStep:id+'PreFlowRequest'}
    preflow['Request'].forEach(function(r) {
      console.log('    request', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata[id+'PreFlowRequest'] = processFlow(r, id+'PreFlowRequest', 'request')
      } else {
        nodes.push({id:id+'PreFlowRequest', label:'Empty Request PreFlow', group:id+'PreFlowRequest'})
        flowMetadata[id+'PreFlowRequest'].firstStep = id+'PreFlowRequest'
        flowMetadata[id+'PreFlowRequest'].lastStep = id+'PreFlowRequest'
      }
      console.log('preFlowRequest', flowMetadata[id+'PreFlowRequest'])
    })

    // Response
    flowMetadata[id+'PreFlowResponse'] = {firstStep:id+'PreFlowResponse', lastStep:id+'PreFlowResponse'}
    preflow['Response'].forEach(function(r) {
      console.log('    response', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata[id+'PreFlowResponse'] = processFlow(r, id+'PreFlowResponse', 'target')
      } else {
        nodes.push({id:id+'PreFlowResponse', label:'Empty Response PreFlow', group:id+'PreFlowResponse'})
        flowMetadata[id+'PreFlowResponse'].firstStep = id+'PreFlowResponse'
        flowMetadata[id+'PreFlowResponse'].lastStep = id+'PreFlowResponse'
      }
      console.log('preFlowResponse', flowMetadata[id+'PreFlowResponse'])
    })
  })
}


////////////////////////////////////////////////////////////////////////////////
/*
 * Cycles through all PostFlows
 * /
function processPostFlows(p, id, defaultFirst, defaultLast) {
  p.PostFlow.forEach(function(postflow) {
    console.log('  postflow', postflow.$.name)

    // Request
    flowMetadata[id+'PostFlowRequest'] = {firstStep:id+'PostFlowRequest', lastStep:id+'PostFlowRequest'}
    postflow['Request'].forEach(function(r) {
      console.log('    request', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata[id+'PostFlowRequest'] = processFlow(r, id+'PostFlowRequest', null, 'RouteRule')
      } else {
        nodes.push({id:id+'PostFlowRequest', label:'Empty Request PostFlow', group:id+'PostFlowRequest'})
        flowMetadata[id+'PostFlowRequest'].firstStep = id+'PostFlowRequest'
        flowMetadata[id+'PostFlowRequest'].lastStep = id+'PostFlowRequest'
      }
    })

    // Response
    flowMetadata[id+'PostFlowResponse'] = {firstStep:id+'PostFlowResponse', lastStep:id+'PostFlowResponse'}
    postflow['Response'].forEach(function(r) {
      console.log('    response', r, typeof r)
      if( typeof r == 'object' ) {
        flowMetadata[id+'PostFlowResponse'] = processFlow(r, id+'PostFlowResponse', null, 'response')
      } else {
        nodes.push({id:id+'PostFlowResponse', label:'Empty Response PostFlow', group:id+'PostFlowResponse'})
        flowMetadata[id+'PostFlowResponse'].firstStep = id+'PostFlowResponse'
        flowMetadata[id+'PostFlowResponse'].lastStep = id+'PostFlowResponse'
      }
      console.log('postFlowResponse', flowMetadata[id+'PostFlowResponse'])
    })
  })
}


////////////////////////////////////////////////////////////////////////////////
// TODO find out if hardcoding Condition[0] is risky
/*
 * Cycles through all Conditional Flows
 */
function processConditionalFlows(p, id, defaultFirst, defaultLast, preReq, postReq, preRes, postRes) {
  var ids = []
  p.Flows.forEach(function(flows) {
    if( typeof flows == 'object' ) {
      flows.Flow.forEach(function(condflow) {
        console.log('  condflow', condflow.$.name, condflow.Condition[0])

        // Request
        condflow['Request'].forEach(function(r) {
          var id = condflow.$.name+'Request'
          ids.push(id)
          console.log('    request', r, typeof r, id)
          if( typeof r == 'object' && flowMetadata[preReq].lastStep && flowMetadata[postReq].firstStep ) {
            flowMetadata[id] = processFlow(r, id, flowMetadata[preReq].lastStep, flowMetadata[postReq].firstStep)
          }
          console.log(id, flowMetadata[id])
        })

        // Response
        condflow['Response'].forEach(function(r) {
          var id = condflow.$.name+'Response'
          ids.push(id)
          console.log('    response', r, typeof r, id)
          if( typeof r == 'object' && flowMetadata[preRes] && flowMetadata[postRes].firstStep ) {
            flowMetadata[id] = processFlow(r, id, flowMetadata[preRes].lastStep, flowMetadata[postRes].firstStep)
          }
          console.log(id, flowMetadata[id])
        })
      })
    }
  })
  return ids
}

////////////////////////////////////////////////////////////////////////////////
/*
 * Cycles through all Conditional Flows
 */
function processRouteRules(p, id) {
  var ids = []
  p.RouteRule.forEach(function(rule) {
    console.log('  routerule', rule.$.name)

    // NOTE: assumed [0] on Condition and TargetEndpoint -- possible issue down the road?
    try {
      ids.push(id+rule.$.name)
      nodes.push({id:id+rule.$.name, label:rule.$.name, group:'RouteRule', condition:rule.Condition[0]})

      // TODO evaluate Condition to decide how to connect edges
      edges.push({from:id+rule.$.name, to:'RouteRule'})
      edges.push({from:id+rule.$.name, to:'T'+rule.TargetEndpoint[0]})
    } catch(e) {}
  })
  return ids
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
function processProxy(p) {
  var id = 'P'+p.ProxyEndpoint.$.name   // ProxyEndpoint identifier
  console.log('Proxy name', id)

  // TODO handle multiple ProxyEndpoints

  // add the static nodes
  nodes.push({id:id+'request', label:'Proxy Endpoint\n'+p.ProxyEndpoint.$.name+'\nRequest', group:'client'})
  nodes.push({id:id+'response', label:'Proxy Endpoint\n'+p.ProxyEndpoint.$.name+'\nResponse', group:'client'})
  nodes.push({id:id+'RouteRule', label:'Proxy Endpoint\n'+p.ProxyEndpoint.$.name+'\nRouting Rules', group:'RouteRule'})


  // assemble individual flows
//  processPreFlows(p.ProxyEndpoint, id)
//  processPostFlows(p.ProxyEndpoint, id)
  var preReqIds = processPrePostFlows(p.ProxyEndpoint, id, 'Pre', 'Request', id+'request', null)
  var posReqIds = processPrePostFlows(p.ProxyEndpoint, id, 'Post', 'Request', null, id+'RouteRule')
  var preResIds = processPrePostFlows(p.ProxyEndpoint, id, 'Pre', 'Response')
  var posResIds = processPrePostFlows(p.ProxyEndpoint, id, 'Post', 'Response', null, id+'response')

  // TODO not sure I trust those four parameters to work in all cases
  var condIds = processConditionalFlows(p.ProxyEndpoint, id, preReqIds[0], posReqIds[0], preResIds[0], posResIds[0])
  var routeRuleIds = processRouteRules(p.ProxyEndpoint, id)

  console.log('proxy ids', preReqIds, posReqIds, preResIds, posResIds)
  console.log('conditional ids', condIds)
  console.log('routerule ids', routeRuleIds)

  // connect flows together into a complete graph of the proxy
  /*
  try {
    // conditional flows request
    Object.keys(flowMetadata).forEach(function(key) {
      console.log('key', key)
      if( [id+'PreFlowRequest', id+'PostFlowRequest', id+'PreFlowResponse', id+'PostFlowResponse'].indexOf(key) === -1 ) {
        console.log('>>>>>>>>>>>>>>>>>>>>>>> process', flowMetadata[key])
        edges.push({from:flowMetadata[id+'PreFlowRequest'].lastStep, to:flowMetadata[key].firstStep})
        edges.push({from:flowMetadata[key].lastStep, to:flowMetadata[id+'PostFlowRequest'].firstStep})
      }
    })
  } catch(e) {
    console.log('exception', e)
  }
  */

  console.log('end of dag generation', nodes, edges)
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
function processTarget(p) {
  var id = 'T'+p.TargetEndpoint.$.name   // TargetEndpoint identifier
  console.log('Target name', id)

  nodes.push({id:id, label:'Target Endpoint\n'+p.TargetEndpoint.$.name, group:'targets'})


  // assemble individual flows
//  processPreFlows(p.TargetEndpoint, id)
//  processPostFlows(p.TargetEndpoint, id)
  var preReqIds = processPrePostFlows(p.TargetEndpoint, id, 'Pre', 'Request', id, null)
  var posReqIds = processPrePostFlows(p.TargetEndpoint, id, 'Post', 'Request', null, id)
  var preResIds = processPrePostFlows(p.TargetEndpoint, id, 'Pre', 'Response', id, null)
  var posResIds = processPrePostFlows(p.TargetEndpoint, id, 'Post', 'Response', null, 'response')

  // TODO not sure I trust those four parameters to work in all cases
  var condIds = processConditionalFlows(p.TargetEndpoint, id, preReqIds[0], posReqIds[0], preResIds[0], posResIds[0])

  console.log('target ids', preReqIds, posReqIds, preResIds, posResIds)
  console.log('conditional ids', condIds)

  // connect flows together into a complete graph of the proxy
  /*
  try {
    // conditional flows request
    Object.keys(flowMetadata).forEach(function(key) {
      console.log('key', key)
      if( [id+'PreFlowRequest', id+'PostFlowRequest', id+'PreFlowResponse', id+'PostFlowResponse'].indexOf(key) === -1 ) {
        console.log('>>>>>>>>>>>>>>>>>>>>>>> process', flowMetadata[key])
        edges.push({from:flowMetadata[id+'PreFlowRequest'].lastStep, to:flowMetadata[key].firstStep})
        edges.push({from:flowMetadata[key].lastStep, to:flowMetadata[id+'PostFlowRequest'].firstStep})
      }
    })
  } catch(e) {
    console.log('exception', e)
  }
  */

  console.log('end of dag generation', nodes, edges)
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// handle HTTP stuff ///////////////////////////////////////////////////////////

app.use(express.static('static'))

app.get('/', function(req, res) {
  res.send('try /proxyviz.html ')
})

app.get('/load', function(req, res) {
  // TODO this is not working
  loadBundle()
  res.redirect('/proxyviz.html')
})

app.get('/proxyviz.js', function(req, res) {
  var script = '' +
               'document.addEventListener("DOMContentLoaded", function(event) {\n' +
               '  var nodes = new vis.DataSet('+proxyNodesToViz()+')\n' +
               '  var edges = new vis.DataSet('+proxyEdgesToViz()+')\n' +
               '  var container = document.getElementById("proxyviz")\n' +
               '  var data = {nodes: nodes, edges: edges}\n' +
               '  var options = {\n' +
               '    autoResize: true,\n' +
//               '    configure: true,\n' +
//               '    layout: {hierarchical: {sortMethod: "directed", direction: "LR"}},\n' +
               '    nodes: {shape:"box"},\n' +
               '    edges: {smooth:false},\n' +
               '    interaction: {hover:true},\n' +
               '    manipulation: true,\n' +
//               '    physics: {enabled: false},\n' +
               '  }\n' +
               '  var network = new vis.Network(container, data, options)\n' +
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
