// TODO: need to figure out how to either
//       model bind the attributes specified to search (ORM) by
//       so they've been parsed to the correct type,
//          or alter the SQL statement to be consistent   <--- attempted solution below.
//          with the type as specified by the schema.

// node-postgres gives a convience function for pools,
// so you don't have to check out a client yourself. 
// See below comment block for checking out a client with pool.
// https://node-postgres.com/features/pooling#single-query

const http = require('http');
const db = require('./db');
// For converting queries / form-data into key/value pairs
const url = require('url');

const port = 3001;

// Table on which CRUD operations will take place
const TABLE_NAME = "Robot";

http.createServer((req, res) => {
    let method = req.method;
    logInfo(`${method} request for resource ${req.url}`);
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers
    res.setHeader("Content-Type", "text/json");
    // Object Destructuring, ES6. 
    // Can assign default values
    // let { id } = url.parse(req.url, true);
    let parsedUrl = url.parse(req.url, true);
    let action = parsedUrl.pathname;
    let body = [];
    req.on("data", (chunk) => {
        body.push(chunk);
        // https://stackoverflow.com/questions/4295782/how-to-process-post-data-in-node-js
        // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
        if (body.length > 1e6) { 
            // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
            sendReqTooLargeError(res);
            request.connection.destroy();
        }
    });
    req.on("end", () => {
        body = Buffer.concat(body).toString();
        // Make sure there's actually data to parse.
        if (body) body = JSON.parse(body);
        // Prioritizes data in body over URL string.
        let params = Object.keys(body).length > 0 ? body : parsedUrl.query;
        let hasParameters = Object.keys(params).length > 0;
        if (hasParameters) {
            logInfo(params);
        }
        // GET
        if (action === '/' && method === 'GET') {
            let searchQuery = `SELECT * FROM "${TABLE_NAME}"`;
            (async () => {
                // Make sure there were parameters passed
                if (hasParameters) {
                    searchQuery += ' WHERE ';
                    let conditions = [];
                    for (let column in params) {
                        let type = await getDbType(column);
                        // console.log(`${column} : ${type}`);
                        if (type === 'text' || type == 'varchar(n)') {
                            conditions.push(`"${column}" = '${params[column]}'`);
                        }
                        else if (type === 'integer') {
                            conditions.push(`"${column}" = ${params[column]}`);
                        }
                    }
                    searchQuery += conditions.join(" AND ");
                }
            })().then(() => {
                searchQuery += ' ORDER BY "id" ASC';
                logInfo("Query built: " + searchQuery);
                db.query(searchQuery, (err, result) => {
                    if (!err) res.end(JSON.stringify(result.rows, null, "\t"));
                    else {
                        throw err;
                    }
                });
            }).catch(error => { logError("DB", error); sendDbError(res); });
        }
        // POST
        else if (action === '/Create' && method === 'POST') {
            // going to have to convert string values to quotes and int to no quotes
            // like above
            let insertQuery = `INSERT INTO "${TABLE_NAME}" VALUES ($1,$2,$3,$4)`;
            if (hasParameters) { 
                db.query(insertQuery, [params.id, params.FirstName, params.LastName, params.CodeName], (err, result) => {
                    if (!err) {
                        logInfo("Query built: " + insertQuery);
                        res.setHeader("Content-Type", "text/html");
                        res.end(`<b>Successfully inserted record.</b>
                                <hr>
                                <div style="font-family: consolas;">
                                    <pre>${JSON.stringify(params, null, 4)}</pre>
                                </div>
                        `);
                    }
                    else {
                        sendDbError(res);
                        console.log(err);
                    }
                });
            }
        }
        // PUT
        // /{id}/Update?new-stuff
        else if (method === 'PUT') {
            let groups = /\/(\d+)\/Update/.exec(action);
            if (groups != null) {
                let id = groups[1];
                let updateQuery = `UPDATE "${TABLE_NAME}" SET ${paramsToCsv(params, placeholder=true)}`
                                + ` WHERE "id" = ${id}`;
                db.query(updateQuery, Object.values(params), (err, result) => {
                    if (!err) {
                        logInfo("Query built: " + updateQuery);
                        res.setHeader("Content-Type", "text/html");
                        res.end(`<b>Successfully updated record ${id}.</b>
                                <hr>
                                <div style="font-family: consolas;">
                                    <pre>${JSON.stringify(params, null, 4)}</pre>
                                </div>
                        `);
                    }
                    else {
                        sendDbError(res);
                        console.log(err);
                    }
                });
            }
            else {
                sendError(res, "PUT request not recognized. Must be of the form <i>/{id}/Update</i>")
            }
        }
        // DELETE
        else if (method === 'DELETE') {
            let groups = /\/(\d+)\/Delete/.exec(action);
            if (groups != null) {
                let id = groups[1];
                let deleteQuery = `DELETE FROM "${TABLE_NAME}" WHERE "id" = $1`;
                db.query(deleteQuery, [id], (err, result) => {
                    if (!err) {
                        logInfo("Query built: " + deleteQuery);
                        res.setHeader("Content-Type", "text/html");
                        res.end(`<b>Successfully deleted record ${id}.</b>`);
                    }
                    else {
                        sendDbError(res);
                        console.log(err);
                    }
                });
            }
        }
    });
}).listen(port, "localhost", err => { 
    if (err) throw err;
    console.log(`[INFO ${new Date(Date.now()).toLocaleTimeString()}] Server started at port ${port}`);
});

function logInfo(msg) {
    if (typeof(msg) === 'object') {
        console.log(`[INFO ${new Date(Date.now()).toLocaleTimeString()}] Object data below\n%O`, msg);
    }
    else if (typeof(msg) === 'string') {
        console.log(`[INFO ${new Date(Date.now()).toLocaleTimeString()}] ${msg}`);
    }
}

function logError(type, msg) {
    console.log(`[${type}-ERROR ${new Date(Date.now()).toLocaleTimeString()}] ${msg}`);
}

async function getDbType(column) {
    // https://stackoverflow.com/questions/2146705/select-datatype-of-the-field-in-postgres
    try {
        // I can't get this to work with parametrization... Doesn't keep the quotes in for pg_typeof
        const { rows } = await db.query(`SELECT pg_typeof("${column}") FROM "${TABLE_NAME}" LIMIT 1`);
        console.log(`${column}   %O`, rows[0]);
        return rows[0]['pg_typeof'];
    } catch (error) {
        throw error;
    }
}

function sendDbError(res) {
    res.setHeader("Content-Type", "text/html");
    res.end("<b>A database error occurred, see server for details.</b>");
}

function sendError(res, msg) {
    res.setHeader("Content-Type", "text/html");
    res.end(`<b>${msg}</b>`);
}

function sendReqTooLargeError(res) {
    res.setHeader("Content-Type", "text/html");
    res.statusCode = 413;
    res.end("<b>Request ignored due to size.</b>");
}

// Returns key/values in the form of
// "key" = value, "key" = value, ... or if placeholders then
// "key" = [placeholder], "key" = [placeholder], ...
function paramsToCsv(params, placeholder=false) {
    let csv = [];
    let count = 1;
    for (let key in params) {
        if (placeholder == false) {
            csv.push(`"${key}" = ${value}`);
        }
        else {
            csv.push(`"${key}" = $${count++}`);
        }
    }
    return csv.join(',');
}

// Can't get to work..
// function pageExists(uri) {
//     let req = http.get("http://localhost:3001", function(res) {
//         console.log(res.statusCode)
//          return res.statusCode;
//     });
//     req.on('error', function(err) {
//         throw err;
//     })
// }

/* Async approach of checking out a client first.
        (async () => {
        let client = await db.connect();
        try {
            let result = await client.query('SELECT * FROM "${TABLE_NAME}" WHERE "RoboId" = $1', [id]);
            res.end(JSON.stringify(result.rows, null, "\t"));
        } finally {
            client.release();
        }
    })().catch(err => console.log(err));
    */