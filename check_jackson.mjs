// One-off AQS API probe. Credentials come from the environment, never from this file:
//   node --env-file=.env.local check_jackson.mjs
const AQS_EMAIL = process.env.AQS_EMAIL;
const AQS_KEY = process.env.AQS_KEY;
if (!AQS_EMAIL || !AQS_KEY) {
  console.error('AQS_EMAIL and AQS_KEY must be set, e.g. node --env-file=.env.local check_jackson.mjs');
  process.exit(1);
}

async function checkJacksonCounty() {
  const state = '28';
  const county = '059'; // Jackson County
  const email = AQS_EMAIL;
  const key = AQS_KEY;

  const url = `https://aqs.epa.gov/data/api/monitors/byCounty?email=${email}&key=${key}&state=${state}&county=${county}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(`Found ${data.Data?.length || 0} monitors in Jackson County.`);
    data.Data?.forEach(m => {
        console.log(`- Site ${m.site_number}: ${m.local_site_name} (${m.latitude}, ${m.longitude})`);
        console.log(`  Param: ${m.parameter_name}, End Date: ${m.last_sample_date || 'Active'}`);
    });
  } catch (e) {
    console.error(e);
  }
}

checkJacksonCounty();
