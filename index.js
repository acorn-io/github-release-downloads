#!/usr/bin/env node

import fetch from 'node-fetch'
import sort from './sort.js'
import yargs from 'yargs'

const parser = yargs(process.argv.slice(2))
  .usage('Get the number of downloads of releases of a GitHub repo\nUsage: $0 <org>[/]<repo>')
  .command('$0 <org> [repo]')
  .positional('org', {
    type: 'string',
    description: 'Organization or Org+Repo name',
  })
  .positional('repo', {
    type: 'string',
    description: 'Repo name'
  })
  .option('username', {
    type: 'string',
    alias: 'u',
    describe: 'Username to authenticate as',
    default: process.env.GITHUB_USERNAME,
  })
  .option('token', {
    type: 'string',
    alias: 't',
    describe: 'Personal access token to authenticate with',
    default: process.env.GITHUB_TOKEN,
  })
  .option('prerelease', {
    type: 'boolean',
    describe: 'Include prereleases',
  })
  .option('group', {
    type: 'string',
    choices: ['major','minor','none'],
    describe: 'Group similar versions together',
    default: 'none'
  })
  .option('match', {
    default: 'binary',
    describe: 'Which kinds of files to match',
    choices: ['sha','binary','all']
  })
  .options('csv', {
    type: 'boolean',
    describe: 'Output comma-separated-values',
  })
  .options('debug', {
    type: 'boolean',
    describe: 'Print more info about what files were considered',
  })
  .demandOption('org')
  .help()

const args = parser.argv;

let org = args.org
let repo = args.repo

if ( org && !repo && org.includes('/') ) {
  const idx = org.indexOf('/')
  repo = org.substring(idx+1)
  org = org.substring(0, idx)
}

const data = {};
const filenames = {};
let longestTag = 0
let longestCount = 0

loop(null, function() {
  if ( args.csv ) {
    console.log('Tag,Downloads,Released')
  }

  sort(Object.keys(data)).forEach((key) => {
    const obj = data[key];

    if ( args.csv ) {
      console.log(`"${obj.tag}",${obj.downloads},${obj.date.replace('Z','').replace('T',' ')}`);
    } else {
      console.log(
        obj.tag.padEnd(longestTag, ' '),
        ' ',
        `${obj.downloads}`.padStart(longestCount, ' '),
        ' ',
        obj.date.replace(/T.*/,'')
      )
    }
  });

  if ( args.debug ) {
    console.error('\nMatched files:')
    for ( const k in filenames ) {
      console.error(' ' + (filenames[k]+'').padStart(8, ' ') + ' ' + k)
    }
  }
});

function loop(url, cb) {
  if ( !url ) {
    url = `https://api.github.com/repos/${ org }/${ repo }/releases`;
  }

  req('GET', url, function(res, body) {
    var json = JSON.parse(body);

    for ( const row of json ) {
      let tag = row.tag_name;
      const date = row.created_at;
      let downloads = 0;

      if ( !args.prerelease ) {
        if ( row.prerelease || tag.includes('-') ) {
          continue;
        }
      }

      // Strip off patch & prerelease
      tag = tag.replace(/[-+].*$/, '');

      if ( args.group !== 'none' ) {
        tag = tag.split('.').slice(0, -1).join('.')
      }

      if ( args.group === 'major' ) {
        tag = tag.split('.').slice(0, -1).join('.')
      }

      longestTag = Math.max(longestTag, tag.length)

      let entry = data[tag];

      if ( entry ) {
        // Use the oldest date
        if ( entry.date > date ) {
          entry.date = date;
        }
      } else {
        entry = { tag, date, downloads: 0 };
        data[tag] = entry;
      }

      const match = args.match.toLowerCase();

      for ( const asset of row.assets ) {
        if ( args.match === 'all' ||
            (args.match === 'binary' && asset.content_type.startsWith('application/') ) ||
            (args.match === 'sha' && asset.name.match(/sha\d+sum/) )
        ) {
          filenames[asset.name] = (filenames[asset.name] || 0) + asset.download_count;
          entry.downloads += asset.download_count || 0;
          longestCount = Math.max(longestCount, `${entry.downloads}`.length)
        }
      }
    }

    const links = parseLinkHeader(res.headers.get('link'));
    if ( links.next ) {
      loop(links.next, cb);
    } else {
      cb();
    }
  });
}

async function req(method, url, cb) {
  // console.error('Request', method, url);
  var opt = {
    method: method,
    headers: {
      'user-agent': 'node',
    }
  };

  if ( args.username && args.token ) {
    opt.headers['authorization'] = 'Basic ' + Buffer.from(`${args.username}:${args.token}`).toString('base64');
  }

  const res = await fetch(url, opt)
  const body = await res.text()


  if ( res.status !== 200 ){
    console.error("Error: ", res.status, body);
    process.exit(1);
  }

  cb(res, body)
}


function parseLinkHeader(str) {
  const out = {};
  const lines = (str || '').split(',');

  for ( const line of lines ) {
    const match = line.match(/^\s*<([^>]+)>\s*;\s*rel\s*="(.*)"/);

    if ( match ) {
      out[match[2].toLowerCase()] = match[1];
    }
  }

  return out;
}
