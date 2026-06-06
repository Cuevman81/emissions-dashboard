async function checkLive() {
  console.log('Querying live EPA Envirofacts database for 2025 TRI submissions in Mississippi...');
  // Query TRI_REPORTING_FORM for 2025 reporting year.
  // The API allows us to fetch records where reporting_year is 2025 and state is MS.
  // Note: Envirofacts tables can be joined or queried by adding path segments.
  const url = 'https://data.epa.gov/efservice/TRI_REPORTING_FORM/REPORTING_YEAR/equals/2025/FACILITY_STATE/equals/MS/rows/1:1000/JSON';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`Failed to reach EPA API. Status: ${res.status}`);
      return;
    }
    const data = await res.json();
    console.log(`Live query returned ${data.length} chemical-facility records for 2025 in MS.`);
    if (data.length > 0) {
      const uniqueFacilities = [...new Set(data.map(r => r.tri_facility_id))];
      console.log(`Unique facility IDs found:`, uniqueFacilities);
      data.slice(0, 5).forEach(r => {
        console.log(` - Facility ID: ${r.tri_facility_id}, Chemical: ${r.cas_chem_name}`);
      });
    } else {
      console.log('No 2025 records returned by the live API.');
    }
  } catch (err) {
    console.error('Error during query:', err.message);
  }
}

checkLive();
