async function checkMS2025() {
  console.log('Querying live TRI_FACILITY for MS facilities...');
  const facilityUrl = 'https://data.epa.gov/efservice/TRI_FACILITY/STATE_ABBR/equals/MS/rows/1:500/JSON';
  try {
    const res = await fetch(facilityUrl);
    if (!res.ok) {
      console.log(`Failed to fetch facilities. Status: ${res.status}`);
      return;
    }
    const facilities = await res.json();
    console.log(`Found ${facilities.length} TRI facilities in MS on Envirofacts.`);

    const triIds = facilities.map(f => f.tri_facility_id).filter(Boolean);
    if (triIds.length === 0) {
      console.log('No TRI facility IDs found.');
      return;
    }

    console.log('Querying live TRI_REPORTING_FORM for 2025 records in parallel...');
    // We can query TRI_REPORTING_FORM where reporting_year is 2025.
    // Let's do a bulk query: TRI_REPORTING_FORM/REPORTING_YEAR/equals/2025/rows/1:5000/JSON
    const formUrl = 'https://data.epa.gov/efservice/TRI_REPORTING_FORM/REPORTING_YEAR/equals/2025/rows/1:1000/JSON';
    const formRes = await fetch(formUrl);
    if (!formRes.ok) {
      console.log(`Failed to fetch reporting forms. Status: ${formRes.status}`);
      return;
    }
    const forms = await formRes.json();
    console.log(`Found ${forms.length} total 2025 TRI records nationally so far on Envirofacts.`);

    // Filter to MS facility IDs
    const msForms = forms.filter(f => triIds.includes(f.tri_facility_id));
    console.log(`Found ${msForms.length} records matching Mississippi facilities.`);
    if (msForms.length > 0) {
      const uniqueMSFacs = [...new Set(msForms.map(f => f.tri_facility_id))];
      console.log('Facilities that have reported 2025 in MS:', uniqueMSFacs);
      uniqueMSFacs.forEach(id => {
        const facName = facilities.find(f => f.tri_facility_id === id)?.facility_name;
        console.log(` - ${id}: ${facName}`);
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}
checkMS2025();
