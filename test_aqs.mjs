const AQS_EMAIL = 'RCuevas@mdeq.ms.gov';
const AQS_KEY = 'greyhawk63';

async function testAqs() {
  const stateCode = '28'; // MS
  const email = AQS_EMAIL;
  const key = AQS_KEY;

  console.log('--- Testing AQS Monitors by State ---');
  const monitorUrl = `https://aqs.epa.gov/data/api/monitors/byState?email=${email}&key=${key}&state=${stateCode}`;
  try {
    const res = await fetch(monitorUrl);
    const data = await res.json();
    console.log(`Found ${data.Data?.length || 0} monitor-parameter records.`);
    if (data.Data && data.Data.length > 0) {
        console.log('Sample Monitor:', data.Data[0].local_site_name, data.Data[0].county_code, data.Data[0].site_number);
    }
  } catch (e) {
    console.error('Monitor fetch failed:', e);
  }

  console.log('\n--- Testing AQS Parameter Classes ---');
  const classUrl = `https://aqs.epa.gov/data/api/metaData/parameterClasses?email=${email}&key=${key}`;
  try {
    const res = await fetch(classUrl);
    const data = await res.json();
    const hasHaps = data.Data?.some(c => c.code === 'HAPS');
    console.log('Is HAPS a valid class?', hasHaps);
  } catch (e) {
      console.error('Class fetch failed:', e);
  }
}

testAqs();
