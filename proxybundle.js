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
  var out = ''
  console.log('NODES----------------------------------------------------------')
  nodes.forEach(function(n) {
    //out += '{ id: "'+n.id+'", value: { label: "'+n.label.replace(/\"/g, "'")+'"'+(n.style?', style:"'+n.style+'"':'')+(n.shape?', shape:"'+n.shape+'"':'')+'} },\n'
    out += '"' + n.id + '": {description: "' + n.label.replace(/\"/g, "'") + '"' + (n.style?', style:"'+n.style+'"':'') + (n.shape?', shape:"'+n.shape+'"':'') + '},\n'

    console.log('{ id: "%s", value: { label: "%s"} },', n.id, n.label)
  })
  return out
  //return JSON.stringify(nodes)
}

////////////////////////////////////////////////////////////////////////////////
function proxyEdgesToViz() {
  var out = ''
  console.log('EDGES----------------------------------------------------------')
  edges.forEach(function(e) {
    //out += '{ u: "'+e.from+'", v: "'+e.to+'" },\n'
    out += 'g.setEdge("'+e.from+'", "'+e.to+'", { label: "abc" })\n'

    console.log('{ u: "%s", v: "%s" },', e.from, e.to)
  })
  return out
  //return JSON.stringify(edges)
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
/*
 * Extracts all nodes and edges from a flow
 *
 * flow - an array of steps
 * id - string to place all these steps into the same group
 * defaultFirst - id of first node, if none is discovered
 * defaultLast - id of last node, if none is discovered
 */
function processFlow(flow, id, defaultFirst, defaultLast) {
  var firstStep
  var lastStep
  var stepCount = 0

  try {
    var prevId
    flow.Step.forEach(function(step) {
      var stepId = id+step.Name[0]
      ++stepCount
      console.log('      step', step, stepId, stepCount)
      if( !firstStep ) {
        if( defaultFirst ) {
          edges.push({from:defaultFirst, to:stepId})
        }
        firstStep = stepId
      }
      nodes.push({id:stepId, label:step.Name[0], group:id})
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
        nodes.push({id:id, label:'Empty '+rr+' '+pp+'Flow', group:id, style:'red'})
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
// TODO find out if hardcoding Condition[0] is risky
/*
 * Cycles through all Conditional Flows
 */
function processConditionalFlows(p, pid, defaultFirst, defaultLast, preReq, postReq, preRes, postRes) {
  var ids = []
  p.Flows.forEach(function(flows) {
    if( typeof flows == 'object' ) {
      flows.Flow.forEach(function(condflow) {
        console.log('  condflow', condflow.$.name, condflow.Condition[0])

        // Request
        condflow['Request'].forEach(function(r) {
          var id = pid+condflow.$.name+'Request'
          ids.push(id)
          console.log('    request', r, typeof r, id)
          if( typeof r == 'object' && flowMetadata[preReq].lastStep && flowMetadata[postReq].firstStep ) {
            nodes.push({id:id, label:'Conditional '+condflow.$.name+' Request'+condflow.Condition[0], group:id, shape:'ellipse'})
            edges.push({from:flowMetadata[preReq].lastStep, to:id})
            flowMetadata[id] = processFlow(r, id, id, flowMetadata[postReq].firstStep)
          }
          console.log(id, flowMetadata[id])
        })

        // Response
        condflow['Response'].forEach(function(r) {
          var id = pid+condflow.$.name+'Response'
          ids.push(id)
          console.log('    response', r, typeof r, id)
          if( typeof r == 'object' && flowMetadata[preRes] && flowMetadata[postRes].firstStep ) {
            nodes.push({id:id, label:'Conditional '+condflow.$.name+' Response'+condflow.Condition[0], group:id})
            edges.push({from:flowMetadata[preRes].lastStep, to:id})
            flowMetadata[id] = processFlow(r, id, id, flowMetadata[postRes].firstStep)
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
      edges.push({from:id+rule.$.name, to:id+'RouteRule'})
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
  nodes.push({id:id+'request', label:'Proxy Endpoint'+p.ProxyEndpoint.$.name+'Request', group:'client'})
  nodes.push({id:id+'response', label:'Proxy Endpoint'+p.ProxyEndpoint.$.name+'Response', group:'client'})
  nodes.push({id:id+'RouteRule', label:'Proxy Endpoint'+p.ProxyEndpoint.$.name+'Routing Rules', group:'RouteRule'})


  // assemble individual flows
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

  // connect flows together into a complete graph of the proxy /////////////////

  // connect each conditional flow between preflow and postflow
  condIds.forEach(function(cid) {
    try {
      console.log('connect conditionals A', cid, flowMetadata[preReqIds[0]], flowMetadata[cid])
      edges.push({from:flowMetadata[preReqIds[0]].lastStep, to:flowMetadata[cid].firstStep})
    } catch(e) {}
    try {
      console.log('connect conditionals B', flowMetadata[cid], flowMetadata[posReqIds[0]])
      edges.push({from:flowMetadata[cid].lastStep, to:flowMetadata[posReqIds[0]].firstStep})
    } catch(e) {}
  })

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

  nodes.push({id:id, label:'Target Endpoint'+p.TargetEndpoint.$.name, group:'targets'})


  // assemble individual flows
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
app.use('/bower_components', express.static('bower_components'))

app.get('/', function(req, res) {
  res.send('try /proxyviz.html ')
})

app.get('/load', function(req, res) {
  // TODO this is not working
  loadBundle()
  res.redirect('/proxyviz.html')
})

app.get('/proxyviz.js', function(req, res) {
  var handlebars = require('handlebars')
  var fs = require('fs')
  var script
  var data = {}
  data.nodes = proxyNodesToViz()
  data.edges = proxyEdgesToViz()

  fs.readFile(__dirname+'/static/dagre-d3-template.hbr', 'utf-8', function(error, source) {
    console.log('data', data)
    var template = handlebars.compile(source);
    script = template(data);
    res.setHeader('Content-Type', 'text/javascript')
    res.write(script)
    res.end()
  })
})

var server = app.listen(3000, function() {
  var host = server.address().address
  var port = server.address().port
  console.log('Listening at http://%s:%s', host, port)
})

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
