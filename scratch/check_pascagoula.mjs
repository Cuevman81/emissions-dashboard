const AQS_EMAIL = 'RCuevas@mdeq.ms.gov';
const AQS_KEY = 'greyhawk63';

async function checkPascagoulaMonitors() {
  const email = AQS_EMAIL;
  const key = AQS_KEY;
  const state = '28';
  const county = '059'; // Jackson County, MS

  console.log('--- Checking Jackson County Monitors (Pascagoula) ---');
  const monitorUrl = `https://aqs.epa.gov/data/api/monitors/byCounty?email=${email}&key=${key}&state=${state}&county=${county}`;
  
  try {
    const res = await fetch(monitorUrl);
    const data = await res.json();
    console.log(`Found ${data.Data?.length || 0} parameter-monitors in Jackson County.`);
    
    if (data.Data && data.Data.length > 0) {
        const uniqueSites = {};
        data.Data.forEach(m => {
            const id = `${m.state_code}${m.county_code}${m.site_number}`;
            if (!uniqueSites[id]) {
                uniqueSites[id] = {
                    id,
                    lat: m.latitude,
                    lon: m.longitude,
                    local_site_name: m.local_site_name,
                    address: m.address,
                    parameters: []
                };
            }
            uniqueSites[id].parameters.push({
                code: m.parameter_code,
                name: m.parameter_name,
                bdate: m.begin_date,
                edate: m.end_date
            });
        });
        
        console.log('Unique Sites:');
        Object.values(uniqueSites).forEach(s => {
            console.log(`- ${s.id}: ${s.local_site_name} (${s.address}) @ ${s.lat}, ${s.lon}`);
            console.log(`  Params: ${s.parameters.map(p => `${p.code} (${p.name})`).join(', ')}`);
        });

        // Check if any match the dashboard's paramList
        const paramList = '44201,42401,88101,42602,42101,81102,45201,43102,43503,43218,43843,14129'.split(',');
        console.log('\n--- Match Check ---');
        Object.values(uniqueSites).forEach(s => {
            const matches = s.parameters.filter(p => paramList.includes(p.code));
            console.log(`Site ${s.id} matches: ${matches.length} parameters`);
            if (matches.length > 0) {
                matches.forEach(m => console.log(`  - Match: ${m.code} (${m.name})`));
            }
        });
    }
  } catch (e) {
    console.error('Test failed:', e);
  }
}

checkPascagoulaMonitors();
