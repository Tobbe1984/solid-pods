import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Postfinance } from './postfinance';

describe('Postfinance', () => {
  let component: Postfinance;
  let fixture: ComponentFixture<Postfinance>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Postfinance],
    }).compileComponents();

    fixture = TestBed.createComponent(Postfinance);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
