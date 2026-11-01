import { GoogleFiles } from '../../google';

/** My Drive: the files of the Google account the person has linked. */
export function Drive() {
  return <GoogleFiles kind="drive" />;
}
