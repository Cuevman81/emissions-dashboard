const AQS_EMAIL = 'RCuevas@mdeq.ms.gov';
const AQS_KEY = 'greyhawk63';

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
