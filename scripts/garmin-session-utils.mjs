/** Keep CLI credential prompting separate from transient session validation failures. */
export async function restoreSessionForCli(garmin, SessionExpiredError) {
  try {
    return await garmin.restoreSession();
  } catch (error) {
    if (error instanceof SessionExpiredError) return false;
    throw error;
  }
}
