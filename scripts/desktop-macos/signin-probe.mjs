/** Both versions are supported: first-party direct login and the older SSO button. */
export async function waitForMycelliosSignIn(page,timeout=90000){
 await page.waitForURL(u=>u.origin==='https://www.mycellios.com'&&(u.pathname.startsWith('/agent')||u.pathname==='/oauth/consent'),{timeout});
 // New profiles choose their interface language before authentication. Keep that
 // real onboarding step; a login probe must not mistake it for a hung renderer.
 const language=page.getByRole('heading',{name:/choose your language|elige tu idioma/i});
 if(await language.waitFor({state:'visible',timeout:15000}).then(()=>true,()=>false)){
  await page.getByRole('button',{name:/^(continue|continuar)$/i}).click();
 }
 const central=async()=>{
  await page.locator('input[type="email"]').waitFor({state:'visible',timeout});
  await page.locator('input[type="password"]').waitFor({state:'visible',timeout});
  await page.locator('button[type="submit"]').waitFor({state:'visible',timeout});
  if(new URL(page.url()).pathname!=='/oauth/consent')throw Error('Unexpected central sign-in route');
  return 'central-account-form';
 };
 const legacy=async()=>{await page.getByRole('button',{name:/continue with Mycellios|continuar con Mycellios/i}).waitFor({state:'visible',timeout});return 'shared-account-button';};
 return Promise.any([central(),legacy()]);
}
