import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environment';

@Injectable({
  providedIn: 'root',
})
export class SolidPodExtensionService {
  constructor() {}

  requestData(description: string, category: string, requestId: string): Observable<any> {
    return new Observable((observer) => {
      // @ts-ignore
      chrome.runtime.sendMessage(
        environment.EXTENSION_ID,
        {
          type: 'DATA_REQUEST',
          description,
          category,
          requestId,
        },
        (response: any) => {
          observer.next(response);
          observer.complete();
        },
      );
    });
  }

  retrieveData(requestId: string, category: string): Observable<any> {
    return new Observable((observer) => {
      // @ts-ignore
      chrome.runtime.sendMessage(
        environment.EXTENSION_ID,
        {
          type: 'DATA_RETRIEVE',
          requestId,
          category,
        },
        (response: any) => {
          observer.next(response);
          observer.complete();
        },
      );
    });
  }
}
