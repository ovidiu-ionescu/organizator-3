import { Component, output, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-user-filter',
  imports: [],
  templateUrl: './user-filter.html',
  styleUrl: './user-filter.css',
})
export class UserFilter {
  filterChange = output<string>();

  private input$ = new Subject<string>();
  private subscription: Subscription;

  constructor() {
    this.subscription = this.input$
      .pipe(
        debounceTime(300),
        distinctUntilChanged()
      )
      .subscribe(value => {
        this.filterChange.emit(value);
      });
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.input$.next(value);
  }

  clearFilter(inputElement: HTMLInputElement) {
    inputElement.value = '';
    this.input$.next('');
    this.filterChange.emit('');
  }
}
