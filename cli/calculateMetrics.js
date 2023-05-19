


async function calculateTurnaroundAverages() {
  try {
    const thirtyDaysAgo = moment().subtract(30, "days").toISOString();

    // Get records from the last 30 days
    const response = await axios.get(`/${AIRTABLE_TABLE_NAME}`, {
      params: {
        filterByFormula: `AND(IS_AFTER({Door Close}, "${thirtyDaysAgo}"), {Turnaround Time} > 0)`,
      },
    });

    const records = response.data.records;
    // console.log('Records fetched from Airtable:', records);

    // Calculate the overall average
    const overallSum = records.reduce(
      (sum, record) => sum + record.fields["Turnaround Time"],
      0
    );
    const overallAvg = overallSum / records.length;
    const overallMinutes = Math.floor(overallAvg / 60);
    const overallSeconds = Math.floor(overallAvg % 60);
    const overallFormatted = `${overallMinutes} minutes, ${overallSeconds} seconds`;

    // Update the overall average in Firebase
    await db.ref("stats/AverageTurnaroundTimeOverall").set(overallFormatted);
    console.log(
      `Updated AverageTurnaroundTimeOverall in Firebase: ${overallFormatted}`
    );

    // Calculate the door's average
    const doorRecords = records.filter(
      (record) => record.fields["Door Number"] === doorNumber
    );
    // console.log(`Door${doorNumber} records:`, doorRecords);

    const doorSum = doorRecords.reduce(
      (sum, record) => sum + record.fields["Turnaround Time"],
      0
    );
    const doorAvg = doorSum / doorRecords.length;
    const doorMinutes = Math.floor(doorAvg / 60);
    const doorSeconds = Math.floor(doorAvg % 60);
    const doorFormatted = `${doorMinutes} minutes, ${doorSeconds} seconds`;

    // Update the door's average in Firebase
    await db
      .ref(`stats/Door${doorNumber}AverageTurnaroundTime`)
      .set(doorFormatted);
    console.log(
      `Updated Door${doorNumber}AverageTurnaroundTime in Firebase: ${doorFormatted}`
    );
  } catch (error) {
    console.error("Error calculating turnaround averages:", error);
  }
}