# proxyviz
A node application that retrieves a proxy bundle and turns it into a graphical representation of the flow, providing all the steps in a single view.

<a href="https://gitlab.apigee.com/apigee/proxyviz/blob/55b2b9cabd2b869d115aca365650874dba7634cf/screenshots/overview.png"><img src="https://gitlab.apigee.com/apigee/proxyviz/blob/55b2b9cabd2b869d115aca365650874dba7634cf/screenshots/overview.png?raw=true"  width="250px" /></a>

<a href="https://gitlab.apigee.com/apigee/proxyviz/blob/master/screenshots/zoom.png"><img src="https://gitlab.apigee.com/apigee/proxyviz/blob/master/screenshots/zoom.png?raw=true"  width="250px" /></a>

## To Run
- Download the source
- Set your Apigee credentials in environment variables
  - Username in APIGEEUN
  - Password in APIGEEPW
    - For example, `export APIGEEUN=myusername`
- Run the Node application, indicating the org, proxy, and revisions
  - `node proxyviz.js everydaybank payment 1`
- Browse to http://localhost:3000/proxyviz.html
- Zoom with the mouse wheel, pan by dragging.  I still need to fix a problem that prevents dragging along the X axis.

## To Do
- Modularize the code into at least
  - Proxy bundle retrieval
  - Express portion
  - Proxy deconstruction into nodes and edges
- Add a form to the web page to specify proxy bundle dynamically
- Display policy icon image at each step
- Display condition for steps that have a Condition specified
- Handle multiple ProxyEndpoints and TargetEndpoints properly.
  - Currently, there is a single array where I gather all the nodes for a given flow.  This actually needs to be a hash indexed by each ProxyEndpoint and TargetEndpoint, so that they don't get overwritten.
- Improve D3 event handling
  - Zoom should center on the cursor
  - Drag does not work on the X axis
    - Getting NaN from zoom event for some reason
- Output to a file
- Tooltip should show useful information when hovering over a step
- Maybe make this more than a viewer, enabling editing from this UI?
