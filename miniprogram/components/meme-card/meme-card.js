Component({
  properties: {
    item: { type: Object, value: null },
    liked: { type: Boolean, value: false },
    showStatus: { type: Boolean, value: false }
  },

  methods: {
    open() {
      if (this.properties.item && this.properties.item._id) {
        this.triggerEvent('open', { id: this.properties.item._id })
      }
    },

    like() {
      if (this.properties.item && this.properties.item._id) {
        this.triggerEvent('like', { id: this.properties.item._id })
      }
    }
  }
})

