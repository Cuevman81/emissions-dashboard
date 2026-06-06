async function checkFields() {
  const url = 'https://data.epa.gov/efservice/TRI_REPORTING_FORM/rows/1:2/JSON';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`Error: ${res.status}`);
      return;
    }
    const data = await res.json();
    console.log('Sample record fields in TRI_REPORTING_FORM:', Object.keys(data[0] || {}));
  } catch (err) {
    console.error('Error:', err.message);
  }
}
checkFields();
