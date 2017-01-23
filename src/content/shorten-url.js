import fetchJsonP from 'fetch-jsonp';
import queryString from 'query-string';
import url from 'url';

export default function shortenURL(urlToShorten) {
  let longURL = urlToShorten;
  if (!longURL.startsWith('https://new.cleopatra.io/')) {
    const parsedURL = url.parse(longURL);
    const parsedURLOnCleopatraIO = Object.assign({}, parsedURL, {
      protocol: 'https:',
      host: 'new.cleopatra.io',
    });
    longURL = url.format(parsedURLOnCleopatraIO);
  }

  const bitlyQueryURL = 'https://api-ssl.bitly.com/v3/shorten?' +
    queryString.stringify({
      'longUrl': longURL,
      'domain': 'clptr.io',
      'access_token': 'd51e4336df90de42b466d731f7534c2e5eaad3bc',
    });
  return fetchJsonP(bitlyQueryURL).then(response => response.json()).then(json => json.data.url);
}
