import { Component } from '@angular/core';
import {environment} from '../../../../environment';
import {getDefaultSession} from '@inrupt/solid-client-authn-browser';
import {overwriteFile} from '@inrupt/solid-client';
import bekb from '../../../../mockdata/bekb.json';
import postfinance from '../../../../mockdata/postfinance.json';

@Component({
  selector: 'app-bekb',
  imports: [],
  templateUrl: './bekb.html',
  styleUrl: './bekb.scss',
})
export class Bekb {
  protected grantAccessToSolidPod() {
    // @ts-ignore
    chrome.runtime.sendMessage(environment.EXTENSION_ID,
      {
        type:        'DATA_REQUEST',
        description: 'Kontoauszüge des Jahres 2025 für Zwick, David',
        category:    'finance',
        requestId:   'test-001'
      },
      (response: any) => console.log(response)
    );
    this.login();
    this.writeFiles();
  }



  login() {
    if (!getDefaultSession().info.isLoggedIn) {
      getDefaultSession().login({
        oidcIssuer: environment.SOLID_OIDC_ISSUER,
        redirectUrl: window.location.href,
        clientName: "Angular Solid Demo"
      });
    }
  }

  writeFiles() {
    this.writeJson(bekb, "http://localhost:3000/bekb/bekb.json").then();
    this.writeJson(postfinance, "http://localhost:3000/bekb/postfinance.json").then();
  }

  async writeJson(input: any, url: string) {
    const session = getDefaultSession();

    const json = {...input, date: new Date()};
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: "application/json"
    });

    await overwriteFile(
      url,
      blob,
      {contentType: "application/json", fetch: session.fetch}
    );
  }
}
