async function checkFacFields() {
  const url = 'https://data.epa.gov/efservice/TRI_FACILITY/rows/1:1/JSON';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`Error: ${res.status}`);
      return;
    }
    const data = await res.json();
    console.log('Columns in TRI_FACILITY:', Object.keys(data[0] || {}));
  } catch (err) {
    console.error('Error:', err.message);
  }
}
checkFacFields();
