async function checkCounts() {
  try {
    for (const year of [2023, 2024, 2025]) {
      const url = `https://data.epa.gov/efservice/TRI_REPORTING_FORM/REPORTING_YEAR/${year}/rows/1:5/JSON`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        console.log(`Year ${year}: successfully fetched ${data.length} sample records.`);
      } else {
        console.log(`Year ${year} failed with status: ${res.status}`);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}
checkCounts();
