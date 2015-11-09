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
  compressed         : true, // sets 'Accept-Encoding' to 'gzip,deflate'
  follow_max         : 5,    // follow up to five redirects
  rejectUnauthorized : true,  // verify SSL certificate
  username: process.env.APIGEEUN,
  password: process.env.APIGEEPW
}

////////////////////////////////////////////////////////////////////////////////
needle.get(url, options, function(err, resp, body) {
  var zip = new AdmZip(body)
  zipEntries = zip.getEntries()
  console.log(zipEntries.length,'files')

  zipEntries.forEach(function(ze) {
    console.log(ze.name,ze.entryName,ze.isDirectory)

    if( ze.entryName.indexOf('apiproxy/policies') >= 0 ) {
      console.log(ze.name,'is a POLICY')
    } else if( ze.entryName.indexOf('apiproxy/proxies') >= 0 ) {
      console.log(ze.name,'is a PROXY')
      xmlparser.parseString(zip.readAsText(ze), function(err, result) {
        var proxy = createProxyDAG(result)
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
function createProxyDAG(p) {
  // add the orginating request as a node
  nodes.push({id:'request', label:'Request'})
  var prevId = 'request'

  var endOfPreFlowRequest = 'request'   // link all conditional flows to this - default to request
  var startOfPostFlowRequest = 'target'

  console.log('Proxy name', p.ProxyEndpoint.$.name)

  // PreFlow
  try {
    console.log('ProxyEndpoint', p.ProxyEndpoint)
    console.log('ProxyEndpoint.PreFlow', p.ProxyEndpoint.PreFlow)
    p.ProxyEndpoint.PreFlow.forEach(function(preflow) {
      console.log('  preflow', preflow.$.name)
      preflow.Request.forEach(function(request) {
        console.log('    request', preflow.$.name)
        request.Step.forEach(function(step) {
          console.log('      step', step)
          nodes.push({id:step.Name[0], label:step.Name[0], group:'PreFlowRequest'})
          if( prevId ) {
            edges.push({from:prevId, to:step.Name[0]})
          }
          prevId = step.Name[0]
          endOfPreFlowRequest = step.Name[0]
        })
      })
    })
  } catch(e) {
    console.log('exception', e)
  }

  try {
    if( p.ProxyEndpoint.PreFlow.Response.length ) {
      p.ProxyEndpoint.PreFlow.Response.Step.forEach(function(step) {
        nodes.push({id:step.Name[0], label:step.Name[0], group:'PreFlowResponse'})
      })
    }
  } catch(e) {
    console.log('exception', e)
  }

  // PostFlow
  try {
    if( p.ProxyEndpoint.PostFlow.Request.length ) {
      p.ProxyEndpoint.PostFlow.Request.Step.forEach(function(step) {
        nodes.push({id:step.Name[0], label:step.Name[0], group:'PostFlowRequest'})
      })
    }
  } catch(e) {
    console.log('exception', e)
  }

  try {
    if( p.ProxyEndpoint.PostFlow.Response.length ) {
      p.ProxyEndpoint.PostFlow.Response.Step.forEach(function(step) {
        nodes.push({id:step.Name[0], label:step.Name[0], group:'PostFlowResponse'})
      })
    }
  } catch(e) {
    console.log('exception', e)
  }

  // conditional flows
  try {
    if( p.ProxyEndpoint.Flows.length ) {
      p.ProxyEndpoint.Flows.forEach(function(flow) {
        console.log('Flow name', flow.name)
      })
    }
  } catch(e) {
    console.log('exception', e)
  }

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
/*
require.config({
  paths: {
    vis: 'node_modules/vis/dist',
  }
});
require(['vis'], function (math) {
  // ... load a visualization
});
*/
