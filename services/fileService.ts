

// This declares the XLSX variable from the script loaded in index.html
declare var XLSX: any;

/**
 * Reads a .csv or .xlsx file and returns its content as an array of objects.
 * @param file The file to be read.
 * @returns A promise that resolves to an array of objects.
 */
export const readFile = <T,>(file: File): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        // Fix: Replaced optional chaining (`?.`) with a standard conditional check for wider compatibility.
        const data = event.target ? event.target.result : null;
        if (!data) {
            reject(new Error("File reader did not return data."));
            return;
        }
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        resolve(json);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.readAsBinaryString(file);
  });
};

/**
 * Exports data to a .csv or .xlsx file and triggers a download.
 * @param data The array of objects to export.
 * @param fileName The name of the file to be downloaded.
 * @param format The format of the file ('csv' or 'xlsx').
 */
export const exportFile = (data: any[], fileName: string, format: 'csv' | 'xlsx') => {
  const worksheet = XLSX.utils.json_to_sheet(data);

  if (format === 'xlsx') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, fileName);
  } else if (format === 'csv') {
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

/**
 * 지수 백오프를 적용한 fetch 재시도 함수
 * @param url 요청 URL
 * @param retries 남은 재시도 횟수
 * @param backoff 재시도 전 대기 시간 (ms)
 * @returns Promise<Response>
 */
const fetchWithRetry = async (url: string, retries: number = 2, backoff: number = 500): Promise<Response> => { // Changed retries to 2, backoff to 500ms
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Throw an error with status for better debugging
      throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
    }
    return response;
  } catch (error: any) { // Explicitly type error as any for consistency
    console.warn(`Fetch attempt failed for ${url}. Retries left: ${retries}. Error: ${error.message}`);
    if (retries <= 0) {
      throw new Error(`Failed to fetch data from ${url} after ${3 /* initial retries was 3, now it's 2, so 2+1 attempts */ - retries} attempts: ${error.message}`); // Adjusted attempts count for error message
    }
    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, backoff));
    return fetchWithRetry(url, retries - 1, backoff * 2); // Exponential backoff
  }
};

/**
 * Fetches data from a Google Apps Script web app URL with retry logic.
 * @param url The URL of the web app.
 * @returns A promise that resolves to an array of objects.
 */
export const fetchSheetData = async <T,>(url: string): Promise<T[]> => {
  try {
    // Use the new fetchWithRetry function
    const response = await fetchWithRetry(url);
    const json = await response.json();
    
    // Check for array format directly or within a 'data' property
    if (Array.isArray(json)) {
        return json as T[];
    }
    if (json && Array.isArray(json.data)) {
        return json.data as T[];
    }
    
    throw new Error("Fetched data is not in the expected array format (expected array or object with 'data' array).");
  } catch (error: any) {
    // Re-throw the error from fetchWithRetry, or add context if it's a parsing error
    console.error(`Error processing sheet data from ${url}:`, error.message);
    throw new Error(`Error processing data from ${url}: ${error.message}`);
  }
};

/**
 * Converts a file to a base64 encoded string.
 * @param file The file to convert.
 * @returns A promise that resolves with the base64 string.
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // remove prefix `data:${file.type};base64,`
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Appends data to a Google Sheet via a Google Apps Script web app URL.
 * @param url The URL of the web app.
 * @param data The data to append.
 * @returns A promise that resolves with the response from the web app.
 */
export const appendSheetData = async (url: string, data: any[]): Promise<any> => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain', // Send as plain text to be safe with simple doPost implementations
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google Sheets API Error: ${response.statusText} (${response.status}). Response: ${errorBody}`);
    }
    // Assume the script returns JSON on success
    return response.json();
  } catch (error) {
    console.error(`Failed to append data to Google Sheet:`, error);
    throw error;
  }
};