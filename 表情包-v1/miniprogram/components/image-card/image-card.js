Component({
  properties: {
    image: {
      type: Object,
      value: {}
    }
  },

  data: {
    totalLikes: 0
  },

  observers: {
    'image.tags'(tags) {
      if (tags && tags.length > 0) {
        const totalLikes = tags.reduce((sum, t) => sum + (t.likes || 0), 0)
        this.setData({ totalLikes })
      }
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('detail', { id: this.properties.image._id })
    },

    onLikeTag(e) {
      const tag = e.currentTarget.dataset.tag
      this.triggerEvent('like', { imageId: this.properties.image._id, tag })
    }
  }
})
