import { Component } from '@angular/core';
import { environment } from '../../../../environment';
import { getDefaultSession } from '@inrupt/solid-client-authn-browser';
import { overwriteFile } from '@inrupt/solid-client';
import { SolidPodExtensionService } from '../../services/solid-pod-extension.service';
import bekb from '../../../../mockdata/bekb.json';
import postfinance from '../../../../mockdata/postfinance.json';
import {
  buildAuthenticatedFetch,
} from "@inrupt/solid-client-authn-core";

@Component({
  selector: 'app-bekb',
  imports: [],
  templateUrl: './bekb.html',
  styleUrl: './bekb.scss',
})
export class Bekb {
  constructor(private solidPodExtensionService: SolidPodExtensionService) {}

  protected grantAccessToSolidPod() {
    const requestId = `bekb-${Date.now()}`;
    this.solidPodExtensionService
      .retrieveData('Grant access to BEKB data', 'BEKB')
      .subscribe(async (response) => {
        console.log('Access request response:', response);
        const authFetch = (url: string, options :any = {}) => {
          return fetch(url, {
            ...options,
            headers: {
              ...options.headers,
              Authorization: `Bearer ${response.session.accessToken}`,
            },
          });
        };
        this.writeFiles(authFetch);
      });
  }

  writeFiles(fetch: any) {
    this.writeJson(bekb, 'http://localhost:3000/timfrey/bekb.json', fetch).then();
    this.writeJson(postfinance, 'http://localhost:3000/timfrey/postfinance.json', fetch).then();
  }

  async writeJson(input: any, url: string, fetch: any) {
    const json = { ...input, date: new Date() };
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: 'application/json',
    });

    await overwriteFile(url, blob, { contentType: 'application/json', fetch });
  }
}
