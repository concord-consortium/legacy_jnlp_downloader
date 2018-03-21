/**
 * Reads a list of activity urls, and creates a JNLP and config file for each activity.
 *
 * 1. Create one .txt file per project in /activities_to_convert/{project-name}.txt, e.g. sam.txt
 * 2. List each activity on a new line. The activities can EITHER be
 *    a. a DIY portal url, e.g.
 *          http://ri-itest.portal.concord.org/diy/view/76/type/ExternalOtrunkActivity/
 *    b. or a url that redirects to a DIY portal url, e.g.
 *          https://learn.concord.org/eresources/112.run_resource_html
 *    c. a JNLPWrapper url, e.g.
 *          http://jnlpwrapper.diy.concord.org/jcl/UDL/udl-plants.jnlp?jnlp=http://static.concord.org/activity-finder/jnlp/udl-plants.jnlp
 * 3. From the command line, run
 *          yarn
 *          node create-jnlps.js {project-name} [-otml]
 * 4. JNLP files and configs, and optional OTML files will be written to
 *          /legacy_jnlp_resources/{project-name}/...
 *    Each filename will contain the original activity number.
 *    If the -otml flag is included, the OTML will be downloaded an modified. Note no attempt
 *    right now is made to parse the OTML for other resources.
 * 5. A CSV file will be created at /results/{project-name}.csv. This file will be in the form:
 *     Title, Original url, New JNLP wrapper url, Wrapped JNLP url, Referenced config url, Referenced OTML url
 */

var request = require('request');
var fs = require('fs');
var mkdirp = require('mkdirp');
var getDirName = require('path').dirname;

var newStaticUrl = "http://models-resources.concord.org/";

var configReplacements = [
  [
    /<object class="net\.sf\.sail\.core\.service\.impl\.CurnitUrlProviderImpl">[\s\S]*?<\/object>/gm,
    `<object class="org.telscenter.sailotrunk.OtmlUrlCurnitProvider">
    <void property="viewSystem">
      <boolean>true</boolean>
    </void>
  </object>`
  ],
  [
    /http:\/\/saildataservice\.concord\.org(.*)nobundles/g,
    "http://static.concord.org/activity-finder/empty-bundle.xml"
  ]
];

var otmlReplacements = [
  [
    /.*OTWorkgroupMemberChooser.*/g,
    ""
  ]
]

var project = process.argv[2];
var downloadOTML = process.argv[3] === "-otml";

console.log(`Writing files for the ${project} project`);

var activities = fs.readFileSync(`activities_to_convert/${project}.txt`).toString().split("\n");

var writeFilesForAllActivities = activities.map(writeNewFilesForActivity)

Promise.all(writeFilesForAllActivities)
.then(writeToSpreadsheet);

function writeNewFilesForActivity(activityUrl) {
  return getPortalUrl(activityUrl)
  .then(getActivityNumber)
  .then(getJNLPWrapperUrl)
  .then(getReferencedJNLP)
  .then(downloadJNLPAndGetProps)
  .then(downloadAndEditConfig)
  .then(downloadAndEditOTML)
  .then(writeFilesToDisk)
}

function getPortalUrl(url) {
  if (~url.indexOf("diy/view") || ~url.indexOf("jnlpwrapper")) {
    return Promise.resolve(url);
  } else {
    return new Promise((resolve, reject) => {
      request.get({
        uri: url,
        followRedirect: false
      }, function (error, response, body) {
        if (!error) {
          var portalUrl = parseAndFindGroup(body, /<a href="([^"]*)">/g);
          if (portalUrl) {
            resolve(portalUrl);
          }
          reject(new Error(`error: could not find portal url from ${body}`));
        } else {
          reject(new Error(`error: ${error}`));
        }
      });
    });
  }
}

function getActivityNumber(portalOrWrapperUrl) {
  var activityNumber;
  if (~portalOrWrapperUrl.indexOf("jnlpwrapper")) {
    activityNumber = parseAndFindGroup(portalOrWrapperUrl, /([^\/]*?)\.jnlp/);
  } else {
    activityNumber = parseAndFindGroup(portalOrWrapperUrl, /view\/(\d*)/g);
  }
  return {portalOrWrapperUrl, activityNumber};
}

function getJNLPWrapperUrl({portalOrWrapperUrl, activityNumber}) {
  if (~portalOrWrapperUrl.indexOf("jnlpwrapper")) {
    return {jnlpWrapperUrl: portalOrWrapperUrl, portalOrWrapperUrl, activityNumber}
  } else {
    return new Promise((resolve, reject) => {
      request.get({
        uri: portalOrWrapperUrl,
        followRedirect: false
      }, function (error, response, body) {
        if (!error) {
          var jnlpWrapperUrl = parseAndFindGroup(body, /<a href="([^"]*)">/g);
          if (jnlpWrapperUrl) {
            resolve({jnlpWrapperUrl, portalOrWrapperUrl, activityNumber});
          }
          reject(new Error(`error: could not find jnlpWrapperUrl from ${body}`));
        } else {
          reject(new Error(`error: ${error}`));
        }
      });
    });
  }
}

function getReferencedJNLP({jnlpWrapperUrl, portalOrWrapperUrl, activityNumber}) {
  var referencedJNLPEncoded = parseAndFindGroup(jnlpWrapperUrl, /jnlp=([^"]*)/g);
  return {jnlpUrl: decodeURIComponent(referencedJNLPEncoded), jnlpWrapperUrl, portalOrWrapperUrl, activityNumber};
}

function downloadJNLPAndGetProps({jnlpUrl, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber}) {
  return new Promise((resolve, reject) => {
    request.get({
      uri: jnlpUrl,
      followRedirect: true
    }, function (error, response, body) {
      if (!error) {
        if (~body.indexOf("<jnlp")) {
          var jnlp = body;
          var configUrl = parseAndFindGroup(jnlp, /<argument>(.*)<\/argument>/g);
          var title = parseAndFindGroup(jnlp, /"otrunk\.view\.frame_title" value="([^"]*)"/g);
          resolve({jnlp, configUrl, title, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber});
        }
        reject(new Error(`${jnlpUrl} did not return a jnlp`))
      } else {
        reject(new Error(`error: ${error}`));
      }
    });
  });
}

function downloadAndEditConfig({jnlp, configUrl, title, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber}) {
  return new Promise((resolve, reject) => {
    request.get({
      uri: configUrl,
      followRedirect: true
    }, function (error, response, body) {
      if (!error) {
        if (~body.indexOf("<java")) {
          var config = body;
          configReplacements.forEach(replacement => {
            config = config.replace(replacement[0], replacement[1]);
          });
          resolve({jnlp, config, configUrl, title, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber});
        }
        reject(new Error(`${configUrl} did not return a config`))
      } else {
        reject(new Error(`error: ${error}`));
      }
    });
  });
}

function downloadAndEditOTML({jnlp, config, configUrl, title, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber}) {
  var otmlUrl = parseAndFindGroup(config, /<string>(.*\.otml)<\/string>/g);
  if (downloadOTML) {
    return new Promise((resolve, reject) => {
      request.get({
        uri: otmlUrl,
        followRedirect: true
      }, function (error, response, body) {
        if (!error) {
          if (~body.indexOf("<otrunk")) {
            var otml = body;
            otmlReplacements.forEach(replacement => {
              otml = otml.replace(replacement[0], replacement[1]);
            })
            resolve({jnlp, config, configUrl, otml, otmlUrl, title, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber});
          }
          reject(new Error(`${configUrl} did not return a config`))
        } else {
          reject(new Error(`error: ${error}`));
        }
      });
    });
  } else {
    return {jnlp, config, configUrl, otmlUrl, title, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber}
  }
}

function writeFilesToDisk({jnlp, config, configUrl, otml, otmlUrl, title, jnlpWrapperUrl, portalOrWrapperUrl, activityNumber}) {
  var jnlpPath   = `legacy_jnlp_resources/${project}/jnlps/${project}-${activityNumber}.jnlp`;
  var configPath = `legacy_jnlp_resources/${project}/configs/${project}-${activityNumber}-config.xml`;
  var otmlPath   = `legacy_jnlp_resources/${project}/otml/${project}-${activityNumber}.otml`;

  var fullJnlpPath   = newStaticUrl + jnlpPath;
  var fullConfigPath = newStaticUrl + configPath;
  var fullOTMLPath   = otml ? newStaticUrl + otmlPath : otmlUrl;

  var jnlpWithNewConfigPath = jnlp.replace(configUrl, fullConfigPath);
  var configWithNewOTMLPath = config.replace(otmlUrl, fullOTMLPath);

  var jnlpWriter   = writeFile(jnlpPath, jnlpWithNewConfigPath);
  var configWriter = writeFile(configPath, config);
  var otmlWriter   = otml ? writeFile(otmlPath, otml) : Promise.resolve();

  return Promise.all([jnlpWriter, configWriter, otmlWriter]).then(() => {
    console.log("  Wrote JNLP and config for ", portalOrWrapperUrl);

    var escapedJnlpPath = encodeURIComponent(fullJnlpPath);
    var jnlpWrapperUrlStart = parseAndFindGroup(jnlpWrapperUrl, /(.*)jnlp=/g);
    var newJnlpWrapper = jnlpWrapperUrlStart + "jnlp=" + escapedJnlpPath;


    return [
      title,
      portalOrWrapperUrl,
      newJnlpWrapper,
      fullJnlpPath,
      fullConfigPath,
      fullOTMLPath
    ];
  })
}

function writeFile(path, data) {
  return new Promise((resolve, reject) => {
    mkdirp(getDirName(path), function (err) {
      if (err) reject(err);
      fs.writeFile(path, data, function(err) {
          if (err) reject(err);
          else resolve();
      });
    });
  });
}

function writeToSpreadsheet(values) {
  var results = values.map(res => res.join()).join("\n");
  var successPath = `results/${project}.csv`;
  writeFile(successPath, results);
}

function parseAndFindGroup(str, regex) {
  m = regex.exec(str)
  if (m && m.length === 2) {
    return m[1];
  }
  console.log(`cannot find group of ${regex} in ${str}`);
  return false;
}