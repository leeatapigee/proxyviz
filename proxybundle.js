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


var org = process.argv[2] || 'amer-demo15'
var api = process.argv[3] || 'Customer360'
var rev = process.argv[4] || '1'


var url = 'https://api.enterprise.apigee.com/v1/organizations/'+org+'/apis/'+api+'/revisions/'+rev+'?format=bundle'

var zipEntries        // stores the bundle for when needed to build the visualization
var nodes = []        // discovered nodes from bundle
var edges = []        // discovered edges from bundle


////////////////////////////////////////////////////////////////////////////////
var options = {
  compressed         : true,        // sets 'Accept-Encoding' to 'gzip,deflate'
  follow_max         : 5,           // follow up to five redirects
  rejectUnauthorized : true,        // verify SSL certificate
  username: process.env.APIGEEUN,
  password: process.env.APIGEEPW
}

////////////////////////////////////////////////////////////////////////////////
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


////////////////////////////////////////////////////////////////////////////////
/*
 * Extracts all nodes and edges from a flow
 *
 * flow - an array of steps
 * reqres - string of value Request or Response (case-sensitive)
 * groupId - string to place all these steps into the same group
 * nodeCount - used to keep all step names unique across all flows
 * priorNode - if provided, priorNode gets attached to this flow's firstStep
 * followingNode - if provided, the lastStep of this flow gets attached to followingNode
 */
function processFlow(flow, reqres, groupId, nodeCount, priorNode, followingNode) {
  var firstStep
  var lastStep
  var newNodes = []
  var newEdges = []

  try {
    var prevId
    flow.forEach(function(f) {
      console.log('  flow', f.$.name, reqres)
      f[reqres].forEach(function(r) {
        console.log('    request', r, typeof r)
        if( typeof r == 'object' ) {
          r.Step.forEach(function(step) {
            var stepId = step.Name[0]+nodeCount++
            console.log('      step', step, stepId)
            if( !firstStep ) {
              firstStep = stepId
              if( priorNode ) {
                newEdges.push({from:priorNode, to:stepId})
              }
            }
            newNodes.push({id:stepId, label:step.Name[0], group:groupId})
            if( prevId ) {
              newEdges.push({from:prevId, to:stepId})
            }
            prevId = stepId
            lastStep = stepId
          })
        }
      })
    })
    if( followingNode ) {
      newEdges.push({from:lastStep, to:followingNode})
    }
  } catch(e) {
    console.log('exception', e)
  }
  return {firstStep:firstStep, lastStep:lastStep, nodes:newNodes, edges:newEdges, nodeCount:nodeCount}
}

////////////////////////////////////////////////////////////////////////////////
function deconstructProxy(p) {
  // add the orginating request and final response as nodes
  nodes.push({id:'request', label:'Request', group:'client'})
  nodes.push({id:'target', label:'Target', group:'targets'})         // TODO use actual TargetEndpoints
  nodes.push({id:'response', label:'Response', group:'client'})

  var prevId = 'request'
  var nodeCount = 0

  console.log('Proxy name', p.ProxyEndpoint.$.name)

  // PreFlow Request
  var prereq = processFlow(p.ProxyEndpoint.PreFlow, 'Request', 'PreFlowRequest', nodeCount, 'request')
  console.log('processFlow returned ',prereq)
  nodeCount = prereq.nodeCount
  nodes = nodes.concat(prereq.nodes)
  edges = edges.concat(prereq.edges)

  // PostFlow Request
  var postreq = processFlow(p.ProxyEndpoint.PostFlow, 'Request', 'PostFlowRequest', nodeCount, null, 'target')
  console.log('processFlow returned ',postreq)
  nodeCount = postreq.nodeCount
  nodes = nodes.concat(postreq.nodes)
  edges = edges.concat(postreq.edges)

  // conditional flows Request//////////////////////////////////////////////////
  try {
    p.ProxyEndpoint.Flows.forEach(function(flows) {
      flows.Flow.forEach(function(flow) {
        flow.forEach(function(fl) {
          var endOfFlow = null

          // Conditional Flows Requests
          var flowsreq = processFlow(fl, 'Request', fl.$.name+'Request', nodeCount, prereq.lastStep, postreq.firstStep)
          console.log('processFlow returned ',flowsreq)
          nodeCount = flowsreq.nodeCount
          nodes = nodes.concat(flowsreq.nodes)
          edges = edges.concat(flowsreq.edges)
        })
      })
    })
  } catch(e) {
    console.log('exception', e)
  }

  // PreFlow Response
  var preres = processFlow(p.ProxyEndpoint.PreFlow, 'Response', 'PreFlowResponse', nodeCount, 'target')
  console.log('processFlow returned ',preres)
  nodeCount = preres.nodeCount
  nodes = nodes.concat(preres.nodes)
  edges = edges.concat(preres.edges)

  edges.push({from:'target', to:preres.lastStep})

  // conditional flows /////////////////////////////////////////////////////////
  try {
    p.ProxyEndpoint.Flows.forEach(function(flows) {
      flows.Flow.forEach(function(flow) {
        var endOfFlow = null

        // Conditional Flows Responses
        var flowsres = processFlow(flow, 'Response', flow.$.name+'Response', nodeCount, preres.lastStep)
        console.log('processFlow returned ',flowsres)
        nodeCount = flowsres.nodeCount
        nodes = nodes.concat(flowsres.nodes)
        edges = edges.concat(flowsres.edges)
      })
    })
  } catch(e) {
    console.log('exception', e)
  }

  // PostFlow Response
  var postres = processFlow(p.ProxyEndpoint.PostFlow, 'Response', 'PostFlowResponse', nodeCount)
  console.log('processFlow returned ',postres)
  nodeCount = postres.nodeCount
  nodes = nodes.concat(postres.nodes)
  edges = edges.concat(postres.edges)

  edges.push({from:postres.lastStep, to:'response'})

  console.log('end of dag generation', nodes, edges)
}


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
app.use(express.static('static'))

app.get('/', function(req, res) {
  res.send('try /proxyviz.html ')
})

app.get('/proxyviz.js', function(req, res) {
  var script = ''
  script += 'document.addEventListener("DOMContentLoaded", function(event) {\n'
  script += '  var nodes = new vis.DataSet('+proxyNodesToViz()+')\n'
  script += '  var edges = new vis.DataSet('+proxyEdgesToViz()+')\n'
  script += '  var container = document.getElementById("proxyviz")\n'
  script += '  var data = {nodes: nodes, edges: edges}\n'
  script += '  var network = new vis.Network(container, data, {})\n'
  script += '})\n'

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
