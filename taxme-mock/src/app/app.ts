import { Component, signal } from '@angular/core';
import {getDefaultSession, login, Session} from '@inrupt/solid-client-authn-browser';
import { environment } from '../../environment';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('solid-angular');

// These values come from Step 2 (or from your account page).
// In production, load these from environment variables.
 // URL of the protected resource to fetch (optional)

  async getSolidData(): Promise<void> {
    const CLIENT_ID = environment.SOLID_CLIENT_ID;
    const CLIENT_SECRET = environment.SOLID_CLIENT_SECRET;
    const OIDC_ISSUER = environment.SOLID_OIDC_ISSUER; // Your authorization server URL (sometimes called IdP, sometimes same as your Solid server URL)
    const RESOURCE_URL = environment.SOLID_RESOURCE_URL;

    // Start the Login Process if not already logged in.
    if (!getDefaultSession().info.isLoggedIn) {
      await login({
        oidcIssuer: OIDC_ISSUER,
        redirectUrl: new URL(window.location.href).toString(),
        clientName: "My application"
      });
    }
  }
}
