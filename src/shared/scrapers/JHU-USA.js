import fipsCodes from 'country-levels/fips.json';
import * as fetch from '../lib/fetch/index.js';
import * as parse from '../lib/parse.js';
import * as geography from '../lib/geography/index.js';
import datetime from '../lib/datetime/index.js';
import maintainers from '../lib/maintainers.js';

// Set county to this if you only have state data, but this isn't the entire state
const UNASSIGNED = '(unassigned)';

function findCountryLevelID(fips) {
  return fipsCodes[fips];
}

const scraper = {
  maintainers: [maintainers.lazd],
  url: 'https://github.com/CSSEGISandData/COVID-19',
  timeseries: true,
  priority: -1,
  country: 'USA',
  aggregate: 'county',
  curators: [
    {
      name: 'JHU CSSE',
      url: 'https://systems.jhu.edu/research/public-health/ncov/'
    }
  ],
  _urls: {
    cases:
      'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_US.csv',
    deaths:
      'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_deaths_US.csv'
  },
  scraper: {
    '0': async function() {
      const urls = this._urls;
      const cases = await fetch.csv(urls.cases, false);
      const deaths = await fetch.csv(urls.deaths, false);

      const regions = [];
      let date = Object.keys(cases[0]).pop();

      if (process.env.SCRAPE_DATE) {
        // Find old date
        const customDate = datetime.getMDYY(new Date(process.env.SCRAPE_DATE));
        if (!cases[0][customDate]) {
          console.warn('  ⚠️  No data present for %s, output will be empty', customDate);
        }
        date = customDate;
      }

      const unassignedCounties = {};
      for (let index = 0; index < cases.length; index++) {
        // Get location info
        const caseInfo = cases[index];
        const deathInfo = deaths[index];
        const fips = caseInfo.FIPS.replace(/\.0$/, '').padStart(5, '0');

        if (fips === '00000' || fips === '88888') {
          console.warn('⚠️  Skipping incorrect FIPS code %s for %s', fips, caseInfo.Combined_Key);
          continue;
        }

        const location = {
          cases: parse.number(caseInfo[date] || 0),
          deaths: parse.number(deathInfo[date] || 0)
        };

        if (caseInfo.Admin2.startsWith('Out of ')) {
          console.warn('⚠️  Skipping out of state data for %s', caseInfo.Combined_Key);
          continue;
        }

        if (caseInfo.Admin2 === 'Unassigned') {
          // This will be normalized in a later step
          location.state = geography.usStates[parse.string(caseInfo.Province_State)];
          location.county = UNASSIGNED;

          if (unassignedCounties[location.state]) {
            // Sum with other unassigned cases
            unassignedCounties[location.state].cases += parse.number(caseInfo[date] || 0);
            unassignedCounties[location.state].deaths += parse.number(deathInfo[date] || 0);
          } else {
            // Store so we can add more
            unassignedCounties[location.state] = location;
          }

          continue;
        }

        // Only include places we have data for
        const countryLevelIDInfo = findCountryLevelID(fips);
        if (!countryLevelIDInfo) {
          console.warn('⚠️  Skipping %s at (FIPS %s)', caseInfo.Combined_Key, fips);
          continue;
        }

        location.county = `fips:${fips}`;
        location.state = `iso2:${countryLevelIDInfo.state_code_iso}`;

        regions.push(location);
      }

      // Add unnassigned data
      for (const state in unassignedCounties) {
        regions.push(unassignedCounties[state]);
      }

      return regions;
    }
  }
};

export default scraper;
