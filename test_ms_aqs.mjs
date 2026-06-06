const AQS_EMAIL = 'RCuevas@mdeq.ms.gov';
const AQS_KEY = 'greyhawk63';

async function testJacksonSite() {
  const email = AQS_EMAIL;
  const key = AQS_KEY;

  // Hinds County (049), Jackson site (0020 is a common one)
  const state = '28';
  const county = '049';
  const year = '2023';
  const bdate = `${year}0101`;
  const edate = `${year}0131`;

  console.log('--- Checking Hinds County Monitors (Jackson) ---');
  const monitorUrl = `https://aqs.epa.gov/data/api/monitors/byCounty?email=${email}&key=${key}&state=${state}&county=${county}`;
  
  try {
    const res = await fetch(monitorUrl);
    const data = await res.json();
    console.log(`Found ${data.Data?.length || 0} parameter-monitors in Hinds County.`);
    
    if (data.Data && data.Data.length > 0) {
        const sites = [...new Set(data.Data.map(m => m.site_number))];
        console.log('Site numbers in Hinds:', sites);
        
        const firstSite = data.Data[0].site_number;
        const param = data.Data[0].parameter_code;
        console.log(`\n--- Fetching Data for Site ${firstSite}, Param ${param} ---`);
        
        const dataUrl = `https://aqs.epa.gov/data/api/dailyData/bySite?email=${email}&key=${key}&param=${param}&bdate=${bdate}&edate=${edate}&state=${state}&county=${county}&site=${firstSite}`;
        const dataRes = await fetch(dataUrl);
        const dataJson = await dataRes.json();
        console.log(`Samples found: ${dataJson.Data?.length || 0}`);
        if (dataJson.Data && dataJson.Data.length > 0) {
            console.log('Sample value:', dataJson.Data[0].sample_measurement, dataJson.Data[0].units_of_measure);
        }
    }
  } catch (e) {
    console.error('Test failed:', e);
  }
}

testJacksonSite();
