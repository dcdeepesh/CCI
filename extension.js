const vscode = require('vscode');
const https = require('https');
const { JSDOM } = require('jsdom');
const path = require('path');

var cookie = undefined;
var csrfToken = undefined;
var initialized = false;
var problemCodes = [];
var startQno = -1;

async function initConfig() {
    /**
    * @param {vscode.Uri} uri
    */
    async function parseConfig(uri) {
        var configFile = await vscode.workspace.openTextDocument(uri);
        for (var i = 0; i < configFile.lineCount; i++) {
            var line = configFile.lineAt(i).text.trim();
            var matches = [];
        
            matches = [...line.matchAll(/starting\s+question\s+number\s*:\s*(\d+)/ig)];
            if (matches.length === 1)
                startQno = parseInt(matches[0][1]);
        
            matches = [...line.matchAll(/https:\/\/www\.codechef\.com\/problems\/(.+)/g)];
            if (matches.length > 0)
                matches.forEach(match => problemCodes.push(match[1]));
        }
    
        return (startQno !== -1 && problemCodes.length !== 0);
    }

    const fileUris = await vscode.workspace.findFiles('dee.codechef.config');
    if (fileUris.length < 1)
        vscode.window.showErrorMessage('No configuration found');
    else if (fileUris.length > 1)
        vscode.window.showErrorMessage('Multiple configurations found');
    else if (!(await parseConfig(fileUris[0])))
        vscode.window.showErrorMessage('Invalid configuration');
    else
        initialized = true;

    return initialized;
}

/**
 * @param {string} problemCode
 * @param {string} code
 */
function uploadCode(problemCode, code) {
    const url = `https://www.codechef.com/api/ide/submit`;
    const postData = `sourceCode=${encodeURIComponent(code)}&language=44&problemCode=${problemCode}&contestCode=PRACTICE`;
    const headers = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Length': postData.length,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookie,
        'Referer': `https://www.codechef.com/submit/${problemCode}`,
        'Origin': 'https://www.codechef.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Safari/537.36',
        'x-csrf-token': csrfToken,
        'X-Requested-With': 'XMLHttpRequest'
    };

    return new Promise(resolve => {
        var response = '';
        var request = https.request(url, { method: 'POST', headers }, res => {
            res.on('data', str => response += str);
            res.on('end', () => resolve(response));
        });
        request.write(postData);
        request.end();
    });
}

/**
 * @param {string} upid
 * @param {string} problemCode
 */
function waitForResult(upid, problemCode) {
    /**
     * @param {string | number} upid
     * @param {string} problemCode
     */
    function getSubmissionStatus(upid, problemCode) {
        const url = `https://www.codechef.com/api/ide/submit?solution_id=${upid}`;
        const headers = {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': cookie,
            'Referer': `https://www.codechef.com/submit/${problemCode}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Safari/537.36',
            'x-csrf-token': csrfToken,
            'X-Requested-With': 'XMLHttpRequest'
        };
    
        return new Promise(resolve => {
            var response = '';
            https.get(url, { headers }, res => {
                res.on('data', str => response += str);
                res.on('end', () => resolve(response));
            }).end();
        });
    }

    return new Promise(resolve => {
        var interval = setInterval(async () => {
            var res = JSON.parse(await getSubmissionStatus(upid, problemCode));
            if (res.result_code.includes('wait'))
                return;

            clearInterval(interval);
        
            if (res.result_code === 'accepted')
                vscode.window.showInformationMessage('✅ Correct answer');
            else if (res.result_code === 'partial_accepted')
                vscode.window.showInformationMessage('• Partially correct answer');
            else if (res.result_code === 'wrong')
                vscode.window.showInformationMessage('❌ Wrong answer');
            else if (res.result_code === 'compile')
                vscode.window.showInformationMessage('❌ Compilation error');
            else if (res.result_code === 'error')
                vscode.window.showInformationMessage('❌ Runtime error');
            else
                vscode.window.showInformationMessage(`• Submission status: ${res.result_code}`);

            resolve(0);
        }, 2000);
    });
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function login(context) {
    async function getVariables() {
        var { cookies, response } = await new Promise(resolve => {
            var response = '';
            var cookies = [];
            https.get('https://www.codechef.com/', res => {
                cookies = res.headers['set-cookie'];
                res.on('data', str => response += str);
                res.on('end', () => resolve({ cookies, response }));
            }).end();
        });
        var document = new JSDOM(response).window.document;
        
        var cookie = cookies.join(';').split(';').map(cookie => cookie.trim())[0];
        var csrfToken = document.querySelector('#new-login-form input[name="csrfToken"]').getAttribute('value');
        var formBuildId = document.querySelector('#new-login-form input[name="form_build_id"]').getAttribute('value');
        var formId = document.querySelector('#new-login-form input[name="form_id"]').getAttribute('value');
        var op = document.querySelector('#new-login-form input[name="op"]').getAttribute('value');
    
        return { cookie, csrfToken, formBuildId, formId, op };
    }

    /**
     * @param {{ cookie: string, csrfToken: string, formBuildId: string, formId: string, op: string }} variables 
     * @param {string} username 
     * @param {string} password 
     * @returns {Promise<{ cookie:string, expiry: number, csrfToken: string }>}
     */
    async function sumbitForm(variables, username, password) {
        const url = `https://www.codechef.com/`;
        const postData =
            `name=${encodeURIComponent(username)}&` +
            `pass=${encodeURIComponent(password)}&` +
            `csrfToken=${encodeURIComponent(variables.csrfToken)}&` +
            `form_build_id=${encodeURIComponent(variables.formBuildId)}&` +
            `form_id=${encodeURIComponent(variables.formId)}&` +
            `op=${encodeURIComponent(variables.op)}`;
        const headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Length': postData.length,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': variables.cookie,
            'Origin': 'https://www.codechef.com',
            'Referer': `https://www.codechef.com/`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Safari/537.36',
        };
    
        return new Promise(resolve => {
            var request = https.request(url, { method: 'POST', headers }, res => {
                var cookies = res.headers['set-cookie'];
                if (cookies === null || cookies === undefined || cookies.length === 0) {
                    resolve(null);
                    return;
                }
    
                var expiry = -1;
                var attributes = cookies[0].split(';').map(c => c.trim());
                attributes.forEach(c => {
                    if (c.startsWith('expires'))
                        expiry = Date.parse(c.split('=')[1]);
                });
    
                resolve({
                    cookie: attributes[0],
                    expiry,
                    csrfToken: variables.csrfToken
                });
            });
            request.write(postData);
            request.end();
        });
    }

    var variablesPromise = getVariables();

    var username = await vscode.window.showInputBox({
        prompt: 'Please log in to CodeChef',
        placeHolder: 'Username',
        ignoreFocusOut: false
    });
    if (username === undefined || username.length === 0)
        return;
    var password = await vscode.window.showInputBox({
        prompt: 'Please log in to CodeChef',
        placeHolder: 'Password',
        password: true,
        ignoreFocusOut: false
    });
    if (password === undefined || password.length === 0)
        return;

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
        title: 'Logging in to CodeChef'
    }, async () => {
        var variables = await variablesPromise;
        var credentials = await sumbitForm(variables, username, password);
        if (credentials === null) {
            vscode.window.showErrorMessage('Incorrect username/password.');
            return Promise.resolve(0);
        }
    
        context.globalState.update('cci.cookie', credentials.cookie);
        context.globalState.update('cci.expiry', credentials.expiry);
        context.globalState.update('cci.csrfToken', credentials.csrfToken);
    
        vscode.window.showInformationMessage('Logged in to CodeChef. You can now submit code.');
        return Promise.resolve(0);
    });
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('cci.clear', () => {
        context.globalState.update('cci.cookie', '');
        context.globalState.update('cci.expiry', '');
        context.globalState.update('cci.csrfToken', '');
        vscode.window.showInformationMessage('CodeChef credentials cleared');
    }));

	context.subscriptions.push(vscode.commands.registerCommand('cci.submit', async uri => {
        // login if required
        cookie = context.globalState.get('cci.cookie');
        csrfToken = context.globalState.get('cci.csrfToken');
        var expiry = context.globalState.get('cci.expiry');
        if (cookie === undefined || csrfToken === undefined ||// cookie.length === 0 ||
            expiry === undefined || Date.now() >= expiry) {
            login(context);
            return;
        }

        // configure if required
		if (!initialized)
            if (!(await initConfig()))
                return;

        // get problem code and source code
        var matches = path.basename(uri.fsPath).match(/\d+/);
        if (matches === null || matches.length === 0) {
            vscode.window.showErrorMessage('Invalid filename (check config?)');
            return;
        }
        var qno = parseInt(matches[0]);
        if (qno - startQno > problemCodes.length) {
            vscode.window.showErrorMessage('Invalid filename (check config?)');
            return;
        }
        var problemCode = problemCodes[qno - startQno];
        var sourceCode = (await vscode.workspace.openTextDocument(uri)).getText();

        // submit
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Submitting',
            cancellable: false
        }, async progress => {
            progress.report({ message: 'Uploading'});
            var submitResponse = JSON.parse(await uploadCode(problemCode, sourceCode));
            console.log(submitResponse);
            if (submitResponse.status !== 'OK') {
                if (submitResponse.status === 'error')
                    vscode.window.showWarningMessage(`Submission error: ${submitResponse.errors[0]}`);
                else
                    vscode.window.showWarningMessage(`Submission error: status=${submitResponse.status}`);
                return;
            }

            progress.report({ message: 'Waiting for result'});
            return waitForResult(submitResponse.upid, problemCode);
        });
	}));
}

module.exports = { activate }